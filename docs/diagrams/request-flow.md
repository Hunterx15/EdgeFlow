# EdgeFlow - Request Flow

## Gateway Proxy Request (e.g. `GET /gateway/users/123`)

The EdgeFlow proxy engine runs 10 stages. Each stage's duration is recorded
in `request_logs.pipeline_stages` so the Pipeline Visualizer page can
render real timings.

```
Client
  │
  │  GET /gateway/users/123   (X-API-Key: ef_live_xxx.yyy)
  ▼
Express app
  │
  ├─► requestId middleware         attaches req.requestId + child logger
  ├─► responseLogger               starts timer, logs on 'finish'
  ├─► helmet, cors, cookieParser, compression
  ├─► /gateway/* mount             proxyMiddleware
  │     │
  │     │  ──── Stage 1: Route Lookup ────────────────────────────
  │     ├─► routeCache.match('GET', '/gateway/users/123')
  │     │     ├─► exactRoutes.get('GET:/gateway/users/123')  ❌
  │     │     └─► wildcard match '/gateway/users/*'          ✅
  │     │         (returns route row with service_id)
  │     │
  │     │  ──── Stage 2: Service Load ────────────────────────────
  │     ├─► servicesService.getById(route.service_id)
  │     │     └─► pg Pool query: SELECT * FROM services WHERE id = $1
  │     │     returns { upstream_targets: [...], enabled, ... }
  │     │
  │     │  ──── Stage 3: API Key Auth (if required) ──────────────
  │     ├─► if route.api_key_required:
  │     │     ├─► parse X-API-Key → (keyId, secretHash)
  │     │     ├─► pg query: SELECT * FROM api_keys WHERE key_id=$1 AND key_hash=$2 AND enabled=TRUE
  │     │     ├─► check enabled + expires_at
  │     │     └─► UPDATE api_keys SET last_used_at=NOW(), total_requests=total_requests+1
  │     │
  │     │  ──── Stage 4: Rate Limit ──────────────────────────────
  │     ├─► rateLimiter.check({ identity, routeId, limitPerMin })
  │     │     ├─► Redis PIPELINE: INCR minute_key; EXPIRE 70
  │     │     ├─► Redis PIPELINE: INCR hour_key;   EXPIRE 3700
  │     │     └─► if count > limit → 429 + Retry-After
  │     │
  │     │  ──── Stage 5: Cache Lookup (GET only) ─────────────────
  │     ├─► if cacheable + cache_ttl_sec > 0:
  │     │     ├─► cacheService.get('cache:r:<routeId>:GET:<url>')
  │     │     └─► if HIT → return cached, set X-Cache: HIT (DONE)
  │     │
  │     │  ──── Stage 6: Load Balancer ───────────────────────────
  │     ├─► loadBalancer.nextTarget(service)
  │     │     ├─► filter to healthyTargetsOnly()
  │     │     ├─► if weights → smoothWeightedRoundRobin()
  │     │     └─► else → simpleRoundRobin()
  │     │
  │     │  ──── Stage 7: Circuit Breaker ─────────────────────────
  │     ├─► circuitBreaker.allowRequest(target.url)
  │     │     ├─► if OPEN & elapsed > openStateMs → HALF_OPEN
  │     │     ├─► if OPEN & elapsed < openStateMs → skip target
  │     │     └─► if HALF_OPEN & inflight > max → skip target
  │     │
  │     │  ──── Stage 8: Path Rewrite ────────────────────────────
  │     ├─► pathRewriter.rewrite({ route, publicPath, query })
  │     │     '/gateway/users/123' + route.upstream_path '/api/users'
  │     │     → '/api/users/123?q=...'
  │     │
  │     │  ──── Stage 9: Reverse Proxy + retry-once ──────────────
  │     ├─► for attempt in 1..2:
  │     │     ├─► set x-edgeflow-* + x-forwarded-* headers
  │     │     ├─► proxy.web(req, res, { target: 'http://user-svc:3001' })
  │     │     ├─► on success: circuitBreaker.recordSuccess(url); break
  │     │     └─► on error:   circuitBreaker.recordFailure(url);
  │     │                     backoff(200ms); try next target
  │     │
  │     │  ──── Stage 10: Response + Log ─────────────────────────
  │     └─► recordLog(req, route, service, target.url, status, latency,
  │                  responseSize, cacheHit, error, apiKeyId, retryCount,
  │                  pipelineStages)
  │           ├─► INSERT INTO request_logs (..., pipeline_stages JSONB)
  │           └─► analyticsService.record() (per-minute rollup upsert)
  │
  └─► response sent to client
        headers: X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining,
                 X-Cache, X-EdgeFlow-Upstream
```

## Admin REST API request (e.g. `POST /api/v1/services`)

```
Client → Express → /api/v1 router → /services router
  → requireAuth middleware (JWT verify)
  → requireRole('admin') (role check)
  → validate.body(serviceCreateSchema)
  → servicesController.create
       → servicesService.create
            → pg Pool INSERT INTO services ...
            → routeCache.invalidate()
            → healthScheduler.schedule(service)
  → ok(res, svc, 201)
```
