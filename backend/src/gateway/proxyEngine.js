/**
 * EdgeFlow - Reverse Proxy Engine
 *
 * The heart of EdgeFlow. When a request arrives at /gateway/<...>:
 *   1. Look up route in route cache
 *   2. Load service + upstream targets
 *   3. API key auth (if route requires it)
 *   4. Rate limit check (sliding window in Redis)
 *   5. Cache lookup (GET only)
 *   6. Pick upstream (weighted round-robin)
 *   7. Circuit breaker check
 *   8. Path rewrite
 *   9. Forward via http-proxy with timeout + retry-once
 *  10. Record log + analytics + pipeline stages
 *
 * Each stage's duration is recorded in req.pipelineStages so the
 * Pipeline Visualization + Timeline features can render real timings.
 */

const httpProxy = require("http-proxy");
const { URL } = require("url");

const routeCache = require("./routeCache");
const pathRewriter = require("./pathRewriter");
const loadBalancer = require("./loadBalancer");
const circuitBreaker = require("../services/circuitBreaker");
const cacheService = require("../services/cacheService");
const rateLimiter = require("../services/rateLimiterService");
const servicesService = require("../services/servicesService");
const apiKeysService = require("../services/apiKeysService");
const analyticsService = require("../services/analyticsService");
const config = require("../config");
const logger = require("../utils/logger");
const { generateRequestId, sleep } = require("../utils/http");
const { queryRaw } = require("../database/pool");

// Hop-by-hop headers MUST NOT be cached or forwarded back to clients.
// RFC 7230 §6.1: these headers are specific to a single connection.
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
];

const proxy = httpProxy.createProxyServer({
  proxyTimeout: config.gateway.requestTimeoutMs,
  timeout: config.gateway.requestTimeoutMs,
  selfHandleResponse: true,
  followRedirects: false,
  changeOrigin: true,
  ws: false,
});

proxy.on("error", (err, _req, _res, target) => {
  logger.warn("proxy: upstream error", {
    error: err.message,
    target: target || null,
  });
});

// ──────────────────────────────────────────────────────────────────
// proxyRes handler — captures upstream responses for caching.
//
// Fires for EVERY proxied request (cacheable or not) because
// selfHandleResponse is true. We must manually write the upstream
// response to the client `res` in ALL cases.
//
// Per-request context is passed via req._proxyContext, which is set
// just before proxy.web() is called in the forward stage below.
// ──────────────────────────────────────────────────────────────────
proxy.on("proxyRes", (proxyRes, req, res) => {
  const ctx = req._proxyContext;
  if (process.env.DEBUG_PROXY) console.log("[proxy] proxyRes fired:", req.method, req.url, "status:", proxyRes.statusCode);

  // Safety fallback: if no context (shouldn't happen in normal flow),
  // just pipe the response through without caching.
  if (!ctx) {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }

  // Collect all response chunks into a single Buffer.
  // This supports both JSON and binary responses safely.
  const chunks = [];
  proxyRes.on("data", (chunk) => {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  });

  proxyRes.on("end", () => {
    const body = Buffer.concat(chunks);
    const status = proxyRes.statusCode || 200;

    // Copy upstream headers and strip hop-by-hop headers.
    // These must not be cached — they are connection-specific.
    const cleanHeaders = { ...proxyRes.headers };
    for (const h of HOP_BY_HOP_HEADERS) delete cleanHeaders[h];

    // Build the response headers we send to the client.
    const responseHeaders = { ...cleanHeaders };

    // Set X-Cache: MISS on cacheable-path requests (even if the response
    // is 4xx/5xx and won't be cached — the header tells the client this
    // response did NOT come from cache).
    if (ctx.cacheKey) {
      responseHeaders["x-cache"] = "MISS";
      responseHeaders["x-cache-ttl"] = String(ctx.cacheTtl);
    }

    // Write the response to the client.
    if (!res.headersSent && !res.writableEnded) {
      try {
        res.writeHead(status, responseHeaders);
        res.end(body);
        if (process.env.DEBUG_PROXY) console.log("[proxy] response written to client, status:", status, "size:", body.length);
      } catch (e) {
        // Client may have disconnected — ignore write errors.
        logger.debug("proxy: res.write/end failed (client gone?)", {
          error: e.message,
        });
      }
    }

    // Record results for logging + circuit-breaker bookkeeping
    // (read by the main flow after the Promise resolves).
    ctx.responseStatus = status;
    ctx.responseSize = body.length;
    ctx.responseSent = true;

    // ── CACHE STORE ──
    // Only cache successful (2xx) GET/HEAD responses.
    // POST/PUT/PATCH/DELETE and 4xx/5xx are never cached.
    if (ctx.cacheKey && status >= 200 && status < 300) {
      const cached = {
        status,
        headers: cleanHeaders, // already stripped of hop-by-hop
        body: body.toString("base64"), // base64 = safe for JSON + binary
      };
      // Fire-and-forget: caching must never block the response.
      cacheService.set(ctx.cacheKey, cached, ctx.cacheTtl).catch((err) => {
        logger.error("CACHE WRITE FAILED", {
          key: ctx.cacheKey,
          ttl: ctx.cacheTtl,
          error: err.message,
        });
      });
    }
  });

  // Handle errors on the upstream response stream (e.g. upstream disconnects
  // mid-response). We can't retry at this point because we may have already
  // sent partial data to the client.
  proxyRes.on("error", (err) => {
    logger.warn("proxy: upstream response stream error", {
      error: err.message,
    });
    if (!res.headersSent && !res.writableEnded) {
      try {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: "UPSTREAM_ERROR",
              message: err.message || "Upstream response error",
            },
          }),
        );
      } catch (e) {
        /* client gone */
      }
    }
    ctx.responseStatus = 502;
    ctx.responseSent = true;
  });
});

function stage(name, fn) {
  // Helper that runs fn() and returns { name, ok, durationMs, result, error }
  return (async () => {
    const start = process.hrtime.bigint();
    try {
      const result = await fn();
      const durationMs = Math.round(
        Number(process.hrtime.bigint() - start) / 1e6,
      );
      return { name, ok: true, durationMs, result };
    } catch (err) {
      const durationMs = Math.round(
        Number(process.hrtime.bigint() - start) / 1e6,
      );
      return { name, ok: false, durationMs, error: err.message };
    }
  })();
}

async function proxyMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  req.requestId = req.headers["x-request-id"] || generateRequestId();
  res.setHeader("X-Request-Id", req.requestId);
  const pipelineStages = [];
  req.pipelineStages = pipelineStages;

  const gatewayPrefix = config.server.gatewayPrefix;
  // Strip the gateway prefix to get the public path that routes are stored
  // under. The route cache stores routes by their `public_path` column,
  // which does NOT include the gateway prefix.
  //
  // BUG FIX (CRITICAL): Previously `routeLookupPath` was set to `fullPath`
  // (with the `/gateway` prefix), so route lookups always missed and every
  // proxied request returned 404 ROUTE_NOT_FOUND. Now we use the stripped
  // `publicPath` for both lookup AND path rewriting.
  const fullPath = req.originalUrl.split("?")[0];
  let publicPath = fullPath.startsWith(gatewayPrefix)
    ? fullPath.slice(gatewayPrefix.length)
    : fullPath;
  if (!publicPath.startsWith("/")) publicPath = "/" + publicPath;
  const routeLookupPath = publicPath;
  const queryString = req.originalUrl.includes("?")
    ? req.originalUrl.split("?")[1]
    : "";

  let route,
    service,
    apiKeyId = null,
    cacheKey = null,
    cacheHit = false;
  let lastErr = null;

  try {
    // Stage 1: route lookup
    const s1 = await stage("Route Lookup", () =>
      routeCache.match(req.method, routeLookupPath),
    );
    if (process.env.DEBUG_PROXY) console.log("[proxy] Stage 1 Route Lookup:", s1.ok, s1.result?.public_path || s1.error);
    pipelineStages.push(s1);
    if (!s1.ok || !s1.result) {
      return res.status(404).json({
        success: false,
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `No route registered for ${req.method} ${routeLookupPath}`,
        },
      });
    }
    route = s1.result;
    if (process.env.DEBUG_PROXY) console.log("[proxy] Stage 1 done, route:", route.public_path, "service_id:", route.service_id);

    // Stage 2: load service
    const s2 = await stage("Service Load", () =>
      servicesService.getById(route.service_id),
    );
    if (process.env.DEBUG_PROXY) console.log("[proxy] Stage 2 Service Load:", s2.ok, s2.result?.name || s2.error);
    pipelineStages.push(s2);
    if (!s2.ok || !s2.result || !s2.result.enabled) {
      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_DISABLED",
          message: "Target service is disabled or missing",
        },
      });
    }
    service = s2.result;

    // Stage 3: API key auth
    if (route.api_key_required) {
      const s3 = await stage("API Key Auth", () =>
        apiKeysService.validate(req.headers["x-api-key"]),
      );
      pipelineStages.push(s3);
      if (!s3.ok || !s3.result?.valid) {
        return res.status(401).json({
          success: false,
          error: {
            code: "INVALID_API_KEY",
            message: s3.result?.reason || "API key required",
          },
        });
      }
      apiKeyId = s3.result.apiKey.id;
      // Per-API-key rate limit overrides the route's default.
      route.rate_limit_per_min = s3.result.apiKey.rate_limit_per_min;
    } else {
      pipelineStages.push({
        name: "API Key Auth",
        ok: true,
        durationMs: 0,
        result: "skipped",
      });
    }

    // Stage 4: rate limit
    const identity = apiKeyId || req.ip || "anon";
    if (process.env.DEBUG_PROXY) console.log("[proxy] Stage 4 Rate Limit starting, identity:", identity);
    const s4 = await stage("Rate Limit", () =>
      rateLimiter.check({
        identity,
        routeId: route.id,
        limitPerMin: route.rate_limit_per_min,
      }),
    );
    if (process.env.DEBUG_PROXY) console.log("[proxy] Stage 4 Rate Limit:", s4.ok, s4.result?.allowed, s4.error);
    pipelineStages.push(s4);
    if (!s4.ok || !s4.result.allowed) {
      res.setHeader("X-RateLimit-Limit", s4.result?.minute.limit || 0);
      res.setHeader(
        "X-RateLimit-Remaining",
        s4.result?.minute.remaining || 0,
      );
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Rate limit exceeded",
          details: s4.result,
        },
      });
    }
    res.setHeader("X-RateLimit-Limit", s4.result.minute.limit);
    res.setHeader("X-RateLimit-Remaining", s4.result.minute.remaining);

    // Stage 5: cache lookup (GET only)
    if (route.cache_ttl_sec > 0 && cacheService.isCacheable(req.method)) {
      cacheKey = cacheService.buildCacheKey({
        routeId: route.id,
        method: req.method,
        originalUrl: routeLookupPath + (queryString ? "?" + queryString : ""),
      });
      const s5 = await stage("Cache Lookup", () => cacheService.get(cacheKey));
      pipelineStages.push(s5);
      if (s5.ok && s5.result) {
        cacheHit = true;
        const latencyMs = latencyMsFrom(startedAt);
        res.setHeader("X-Cache", "HIT");
        res.setHeader("X-Cache-TTL", route.cache_ttl_sec);
        recordLog(
          req,
          route,
          service,
          null,
          s5.result.status || 200,
          latencyMs,
          0,
          true,
          null,
          apiKeyId,
          0,
          pipelineStages,
        );
        // Body is stored as base64 in Redis — decode back to Buffer.
        // This safely handles both JSON and binary cached responses.
        const cachedBody = s5.result.body
          ? Buffer.from(s5.result.body, "base64")
          : Buffer.alloc(0);
        return res
          .status(s5.result.status || 200)
          .set(s5.result.headers || {})
          .end(cachedBody);
      }
    } else {
      pipelineStages.push({
        name: "Cache Lookup",
        ok: true,
        durationMs: 0,
        result: "skipped",
      });
    }

    // Stage 6: pick upstream (weighted round-robin)
    const s6 = await stage("Load Balancer", () =>
      Promise.resolve(loadBalancer.nextTarget(service)),
    );
    pipelineStages.push(s6);
    if (!s6.ok || !s6.result) {
      const latencyMs = latencyMsFrom(startedAt);
      recordLog(
        req,
        route,
        service,
        null,
        503,
        latencyMs,
        0,
        false,
        "No healthy upstream",
        apiKeyId,
        0,
        pipelineStages,
      );
      return res.status(503).json({
        success: false,
        error: {
          code: "NO_HEALTHY_UPSTREAM",
          message: "All upstream targets are unhealthy",
        },
      });
    }
    const target = s6.result;

    // Stage 7: circuit breaker
    const s7 = await stage("Circuit Breaker", () => {
      const decision = circuitBreaker.allowRequest(target.url);
      if (!decision.allowed) {
        const err = new Error(`Circuit breaker ${decision.state}`);
        err.code = "CIRCUIT_OPEN";
        throw err;
      }
      return decision;
    });
    pipelineStages.push(s7);
    if (!s7.ok) {
      const latencyMs = latencyMsFrom(startedAt);
      recordLog(
        req,
        route,
        service,
        target.url,
        503,
        latencyMs,
        0,
        false,
        s7.error,
        apiKeyId,
        0,
        pipelineStages,
      );
      return res.status(503).json({
        success: false,
        error: {
          code: "CIRCUIT_OPEN",
          message: "Circuit breaker open for this upstream",
        },
      });
    }

    // Stage 8: path rewrite — uses the STRIPPED publicPath (without /gateway),
    // so the route's public_path prefix can be correctly removed.
    const upstreamPath = pathRewriter.rewrite({
      route,
      publicPath: routeLookupPath,
      originalQuery: queryString,
    });
    logger.debug("proxy: forwarding", {
      method: req.method,
      upstreamPath,
      target: target.url,
    });
    const upstreamUrl = new URL(target.url);
    const targetBaseUrl = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
    pipelineStages.push({
      name: "Path Rewrite",
      ok: true,
      durationMs: 0,
      result: upstreamPath,
    });

    // Set forwarding headers
    req.headers["x-edgeflow-request-id"] = req.requestId;
    req.headers["x-edgeflow-service-id"] = service.id;
    req.headers["x-edgeflow-route-id"] = route.id;
    req.headers["x-edgeflow-upstream"] = target.url;
    req.headers["x-forwarded-host"] = req.headers.host || "";
    req.headers["x-forwarded-proto"] = req.protocol || "http";

    // Stage 9: forward via http-proxy with retry-once
    //
    // selfHandleResponse is true, so the proxyRes handler (registered above)
    // is responsible for writing the upstream response to `res` and for
    // calling cacheService.set(). This loop only orchestrates retries on
    // connection-level errors (the proxy.web callback).
    let responseSent = false;
    let attempts = 0;
    const maxAttempts = 1 + config.gateway.maxRetries;
    const forwardStart = process.hrtime.bigint();

    // Per-request context for the shared proxyRes handler.
    // This carries cacheKey, cacheTtl, and the target URL so the handler
    // knows what to cache and which circuit breaker to update.
    req._proxyContext = {
      cacheKey, // null if route is not cacheable
      cacheTtl: route.cache_ttl_sec,
      targetUrl: target.url,
      responseStatus: null, // filled by proxyRes handler
      responseSize: 0, // filled by proxyRes handler
      responseSent: false, // filled by proxyRes handler
    };

    // Save the original url so we can restore it on each retry attempt
    // (proxy.web may mutate req.url).
    const originalUrl = upstreamPath;

    while (attempts < maxAttempts && !responseSent) {
      attempts += 1;
      try {
        await new Promise((resolve, reject) => {
          // Restore req.url on every attempt — proxy.web reads it.
          req.url = originalUrl;

          // `finish` fires after the proxyRes handler calls res.end().
          // Use `once` so the listener is removed automatically after firing
          // (prevents the listener leak that occurred when retry happened
          // without `finish` firing — the listener stayed bound on res).
          const onFinish = () => {
            responseSent = true;
            cleanup();
            resolve();
          };
          const onError = (err) => {
            cleanup();
            reject(err);
          };
          const cleanup = () => {
            res.removeListener("finish", onFinish);
            res.removeListener("error", onError);
          };
          res.once("finish", onFinish);
          res.once("error", onError);

          proxy.web(req, res, { target: targetBaseUrl }, (err) => {
            if (process.env.DEBUG_PROXY) console.log("[proxy] proxy.web callback fired, err:", err?.message);
            if (err) {
              // Connection-level error (before any response was received).
              // This is the ONLY path that triggers retry.
              cleanup();
              logger.warn("proxy: forward failed", {
                error: err.message,
                target: target.url,
                attempt: attempts,
              });
              circuitBreaker.recordFailure(target.url);
              if (!res.headersSent) {
                if (attempts < maxAttempts) {
                  // Schedule retry — resolve so the while-loop continues.
                  setTimeout(() => resolve(), config.gateway.retryDelayMs);
                } else {
                  reject(err);
                }
              } else {
                // Headers already sent — can't retry, response is in flight.
                resolve();
              }
            }
          });
        });
      } catch (err) {
        lastErr = err;
        if (attempts >= maxAttempts) break;
        await sleep(config.gateway.retryDelayMs);
      }
    }

    // Read results from the proxyRes handler's context.
    const ctx = req._proxyContext;
    delete req._proxyContext;
    const responseStatus = ctx?.responseStatus;
    const responseSize = ctx?.responseSize || 0;

    const forwardDurationMs = Math.round(
      Number(process.hrtime.bigint() - forwardStart) / 1e6,
    );
    pipelineStages.push({
      name: "Reverse Proxy",
      ok: responseSent,
      durationMs: forwardDurationMs,
      result: responseStatus ? `${responseStatus}` : "failed",
    });

    if (!responseSent && !res.headersSent) {
      const latencyMs = latencyMsFrom(startedAt);
      recordLog(
        req,
        route,
        service,
        target.url,
        502,
        latencyMs,
        0,
        false,
        lastErr?.message || "Upstream unavailable",
        apiKeyId,
        attempts - 1,
        pipelineStages,
      );
      return res.status(502).json({
        success: false,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "All upstream targets failed",
          details: { attempts, lastError: lastErr?.message },
        },
      });
    }

    // Circuit-breaker bookkeeping based on response status
    if (responseStatus >= 500) circuitBreaker.recordFailure(target.url);
    else if (responseStatus) circuitBreaker.recordSuccess(target.url);

    const latencyMs = latencyMsFrom(startedAt);
    pipelineStages.push({
      name: "Response",
      ok: true,
      durationMs: 0,
      result: `${responseStatus || 200}`,
    });
    recordLog(
      req,
      route,
      service,
      target.url,
      responseStatus || 200,
      latencyMs,
      responseSize,
      cacheHit,
      null,
      apiKeyId,
      attempts - 1,
      pipelineStages,
    );
    return undefined;
  } catch (err) {
    const latencyMs = latencyMsFrom(startedAt);
    logger.error("proxy: unhandled error", {
      error: err.message,
      stack: err.stack,
    });
    recordLog(
      req,
      route || null,
      service || null,
      null,
      500,
      latencyMs,
      0,
      false,
      err.message,
      apiKeyId,
      0,
      pipelineStages,
    );
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Gateway internal error" },
      });
    }
    return undefined;
  }
}

function latencyMsFrom(startedAtBigInt) {
  return Math.round(Number(process.hrtime.bigint() - startedAtBigInt) / 1e6);
}

function recordLog(
  req,
  route,
  service,
  upstreamUrl,
  status,
  latencyMs,
  responseSize,
  cacheHit,
  error,
  apiKeyId,
  retryCount = 0,
  stages = [],
) {
  const payload = {
    requestId: req.requestId,
    method: req.method,
    publicPath: req.path || req.url.split("?")[0],
    serviceId: service?.id || null,
    routeId: route?.id || null,
    apiKeyId: apiKeyId || null,
    upstreamUrl,
    statusCode: status,
    latencyMs,
    responseSize,
    error,
    clientIp: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 512),
    cacheHit,
    retryCount,
    pipelineStages: stages.length
      ? JSON.stringify(
          stages.map((s) => ({
            name: s.name,
            ok: s.ok,
            durationMs: s.durationMs,
            result: typeof s.result === "string" ? s.result : "ok",
            error: s.error,
          })),
        )
      : null,
  };
  Promise.all([
    queryRaw(
      `INSERT INTO request_logs (request_id, method, public_path, service_id, route_id, api_key_id,
         upstream_url, status_code, latency_ms, response_size, error, client_ip, user_agent,
         cache_hit, retry_count, pipeline_stages)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
      [
        payload.requestId,
        payload.method,
        payload.publicPath,
        payload.serviceId,
        payload.routeId,
        payload.apiKeyId,
        payload.upstreamUrl,
        payload.statusCode,
        payload.latencyMs,
        payload.responseSize,
        payload.error,
        payload.clientIp,
        payload.userAgent,
        payload.cacheHit,
        payload.retryCount,
        payload.pipelineStages,
      ],
    ).catch((e) => logger.warn("log insert failed", { error: e.message })),
    analyticsService.record({
      serviceId: payload.serviceId,
      statusCode: payload.statusCode,
      latencyMs: payload.latencyMs,
      cacheHit: payload.cacheHit,
    }),
  ]).catch(() => {});
}

module.exports = { proxyMiddleware, proxy };
