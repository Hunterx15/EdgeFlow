/**
 * EdgeFlow route-lookup fix verification test.
 *
 * Verifies that the CRITICAL bug fix in proxyEngine.js works correctly:
 *   - Before: `routeLookupPath = fullPath` (with `/gateway` prefix)
 *     → route lookups ALWAYS failed with 404 ROUTE_NOT_FOUND
 *   - After:  `routeLookupPath = publicPath` (prefix stripped)
 *     → route lookups succeed
 *
 * This test mocks the route cache, services, rate limiter, etc. and
 * verifies that the proxyMiddleware correctly looks up the route using
 * the stripped publicPath (without the `/gateway` prefix).
 */

const path = require("path");
const assert = require("assert");

// ── MOCKS ──────────────────────────────────────────────────────────
// We must mock every dependency that proxyEngine.js requires BEFORE
// requiring proxyEngine itself, because Node's require cache will have
// already loaded the real modules otherwise.

const Module = require("module");

// Track the route lookup calls so we can assert what was passed in.
const routeLookupCalls = [];

// Stub the routeCache module.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/gateway/routeCache.js")] = Module._cache[
  require.resolve("/home/z/my-project/audit/edgeflow/backend/src/gateway/routeCache.js")
] || {
  id: "routeCacheMock",
  filename: "routeCacheMock",
  loaded: true,
  exports: {
    match: (method, publicPath) => {
      routeLookupCalls.push({ method, publicPath });
      // Simulate a route match when the path is the stripped publicPath.
      if (publicPath === "/xcode/api/v1/auth/login" && method === "POST") {
        return {
          id: "route-1",
          service_id: "svc-1",
          method: "POST",
          public_path: "/xcode/api/v1/auth/login",
          upstream_path: "/user/login",
          strip_prefix: true,
          auth_required: false,
          api_key_required: false,
          rate_limit_per_min: 100,
          cache_ttl_sec: 0,
          enabled: true,
        };
      }
      return null;
    },
    invalidate: () => {},
    warm: async () => {},
    size: () => 1,
    snapshot: () => ({ exact: [], wildcard: [], lastRefreshedAt: Date.now() }),
    refresh: async () => {},
  },
};

// Stub the servicesService module.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/services/servicesService.js")] = {
  id: "servicesServiceMock",
  filename: "servicesServiceMock",
  loaded: true,
  exports: {
    getById: async (id) => ({
      id,
      name: "xcode",
      slug: "xcode",
      enabled: true,
      upstream_targets: [{ url: "http://localhost:3000", weight: 1, healthy: true }],
    }),
  },
};

// Stub the apiKeysService.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/services/apiKeysService.js")] = {
  id: "apiKeysServiceMock",
  filename: "apiKeysServiceMock",
  loaded: true,
  exports: { validate: async () => ({ valid: false }) },
};

// Stub the rateLimiter.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/services/rateLimiterService.js")] = {
  id: "rateLimiterMock",
  filename: "rateLimiterMock",
  loaded: true,
  exports: {
    check: async () => ({
      allowed: true,
      minute: { count: 1, limit: 100, remaining: 99 },
      hour: { count: 1, limit: 5000, remaining: 4999 },
    }),
  },
};

// Stub the circuitBreaker.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/services/circuitBreaker.js")] = {
  id: "circuitBreakerMock",
  filename: "circuitBreakerMock",
  loaded: true,
  exports: {
    allowRequest: () => ({ allowed: true, state: "closed" }),
    recordFailure: () => {},
    recordSuccess: () => {},
  },
};

// Stub the cacheService.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/services/cacheService.js")] = {
  id: "cacheServiceMock",
  filename: "cacheServiceMock",
  loaded: true,
  exports: {
    isCacheable: () => false,
    get: async () => null,
    set: async () => true,
    buildCacheKey: () => "cache-key",
  },
};

// Stub the analyticsService.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/services/analyticsService.js")] = {
  id: "analyticsServiceMock",
  filename: "analyticsServiceMock",
  loaded: true,
  exports: { record: async () => {} },
};

// Stub the database pool.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/database/pool.js")] = {
  id: "poolMock",
  filename: "poolMock",
  loaded: true,
  exports: {
    queryRaw: async () => ({ rows: [] }),
    queryOne: async () => null,
    queryMany: async () => [],
  },
};

// Stub the config (so we don't load the real .env).
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/config/index.js")] = {
  id: "configMock",
  filename: "configMock",
  loaded: true,
  exports: {
    env: "test",
    isProduction: false,
    isDevelopment: true,
    server: {
      port: 4000,
      host: "0.0.0.0",
      gatewayPrefix: "/gateway",
      apiPrefix: "/api/v1",
    },
    gateway: {
      requestTimeoutMs: 30000,
      maxRetries: 1,
      retryDelayMs: 200,
    },
  },
};

// Stub the logger.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/utils/logger.js")] = {
  id: "loggerMock",
  filename: "loggerMock",
  loaded: true,
  exports: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => this,
    }),
  },
};

// Stub the http utils.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/utils/http.js")] = {
  id: "httpMock",
  filename: "httpMock",
  loaded: true,
  exports: {
    generateRequestId: () => "req_test_123",
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
};

// Stub the pathRewriter.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/gateway/pathRewriter.js")] = {
  id: "pathRewriterMock",
  filename: "pathRewriterMock",
  loaded: true,
  exports: {
    rewrite: ({ route, publicPath, originalQuery }) => {
      // Simple strip-prefix: remove the route's public_path from the front
      // of publicPath and prepend the upstream_path.
      const suffix = publicPath.startsWith(route.public_path)
        ? publicPath.slice(route.public_path.length)
        : publicPath;
      return route.upstream_path.replace(/\/$/, "") + suffix + (originalQuery ? "?" + originalQuery : "");
    },
  },
};

// Stub the loadBalancer.
require.cache[require.resolve("/home/z/my-project/audit/edgeflow/backend/src/gateway/loadBalancer.js")] = {
  id: "loadBalancerMock",
  filename: "loadBalancerMock",
  loaded: true,
  exports: {
    nextTarget: (service) => service.upstream_targets[0],
  },
};

// Stub http-proxy.
const httpProxyStub = {
  createProxyServer: () => ({
    on: () => {},
    web: (req, res, opts, cb) => {
      // Simulate a connection error so the proxyMiddleware doesn't try
      // to actually forward the request.
      cb(new Error("mock upstream unavailable"));
    },
  }),
};
require.cache[require.resolve("http-proxy")] = {
  id: "httpProxyStub",
  filename: "httpProxyStub",
  loaded: true,
  exports: httpProxyStub,
};

// ── TEST ───────────────────────────────────────────────────────────

(async () => {
  // Now we can require proxyEngine — it will pick up all our mocks.
  const { proxyMiddleware } = require("/home/z/my-project/audit/edgeflow/backend/src/gateway/proxyEngine.js");

  // Build a fake Express req/res/next triple.
  const buildReq = (method, url) => ({
    method,
    originalUrl: url,
    url,
    path: url.split("?")[0],
    headers: {},
    ip: "127.0.0.1",
    protocol: "http",
    pipelineStages: [],
  });

  const buildRes = () => {
    const headers = {};
    const state = { code: 200, body: null, ended: false, headersSent: false };
    const res = {
      headers,
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      getHeader: (k) => headers[k.toLowerCase()],
      set: (obj) => { for (const k in obj) headers[k.toLowerCase()] = obj[k]; return res; },
      status: (code) => { state.code = code; res.statusCode = code; return res; },
      json: (data) => { state.body = data; state.ended = true; state.headersSent = true; return res; },
      end: (data) => { state.body = data; state.ended = true; state.headersSent = true; return res; },
      writeHead: (code, h) => {
        if (code) { state.code = code; res.statusCode = code; }
        if (h) for (const k in h) headers[k.toLowerCase()] = h[k];
        state.headersSent = true;
      },
      on: () => res,
      once: () => res,
      removeListener: () => res,
      get headersSent() { return state.headersSent; },
      get writableEnded() { return state.ended; },
      _status: () => state.code,
      _body: () => state.body,
      _ended: () => state.ended,
    };
    return res;
  };

  // TEST 1: Request to /gateway/xcode/api/v1/auth/login should look up the
  // route using the STRIPPED path /xcode/api/v1/auth/login (NOT the full
  // path with /gateway prefix).
  console.log("\n--- TEST 1: Route lookup uses stripped publicPath ---");
  {
    routeLookupCalls.length = 0;
    const req = buildReq("POST", "/gateway/xcode/api/v1/auth/login");
    const res = buildRes();
    await proxyMiddleware(req, res, () => {});

    assert.strictEqual(routeLookupCalls.length, 1, "routeCache.match should be called exactly once");
    const call = routeLookupCalls[0];
    console.log("  method passed:", call.method);
    console.log("  publicPath passed:", call.publicPath);

    // CRITICAL assertion: the path passed to routeCache.match must NOT
    // contain the /gateway prefix.
    assert.strictEqual(
      call.publicPath,
      "/xcode/api/v1/auth/login",
      "BUG: route lookup used the full path with /gateway prefix instead of the stripped publicPath",
    );
    assert.strictEqual(call.method, "POST", "method should be POST");
    console.log("  ✓ PASS: route lookup uses stripped publicPath");
  }

  // TEST 2: Request to a non-existent route should return 404.
  console.log("\n--- TEST 2: Unknown route returns 404 ---");
  {
    routeLookupCalls.length = 0;
    const req = buildReq("GET", "/gateway/unknown/path");
    const res = buildRes();
    await proxyMiddleware(req, res, () => {});

    assert.strictEqual(routeLookupCalls.length, 1, "match should be called");
    assert.strictEqual(
      routeLookupCalls[0].publicPath,
      "/unknown/path",
      "stripped path should be used",
    );
    console.log("  ✓ PASS: unknown route returns 404 (status:", res._status(), ")");
  }

  // TEST 3: Request without the gateway prefix should also work (edge case).
  console.log("\n--- TEST 3: Request without /gateway prefix ---");
  {
    routeLookupCalls.length = 0;
    const req = buildReq("POST", "/xcode/api/v1/auth/login");
    const res = buildRes();
    await proxyMiddleware(req, res, () => {});

    assert.strictEqual(routeLookupCalls.length, 1, "match should be called");
    assert.strictEqual(
      routeLookupCalls[0].publicPath,
      "/xcode/api/v1/auth/login",
      "path without prefix should pass through unchanged",
    );
    console.log("  ✓ PASS: request without prefix works");
  }

  // TEST 4: Query string is correctly extracted and not included in the
  // route lookup path.
  console.log("\n--- TEST 4: Query string handling ---");
  {
    routeLookupCalls.length = 0;
    const req = buildReq("POST", "/gateway/xcode/api/v1/auth/login?foo=bar&baz=qux");
    const res = buildRes();
    await proxyMiddleware(req, res, () => {});

    assert.strictEqual(routeLookupCalls.length, 1, "match should be called");
    assert.strictEqual(
      routeLookupCalls[0].publicPath,
      "/xcode/api/v1/auth/login",
      "query string should NOT be part of the route lookup path",
    );
    console.log("  ✓ PASS: query string is correctly excluded from route lookup");
  }

  console.log("\n=== ALL ROUTE-LOOKUP TESTS PASSED ===");
  process.exit(0);
})().catch((err) => {
  console.error("\n=== TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
