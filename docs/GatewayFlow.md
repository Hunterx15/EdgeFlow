# Gateway Flow

## Request Lifecycle

Every request to `/gateway/<publicPath>` passes through a 10-stage pipeline. Each stage records its latency and result for the Pipeline Visualizer and request logs.

```
Client Request
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│  Express Middleware                                          │
│  helmet → cors → cookieParser → compression → requestId     │
│  → responseLogger                                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Route Lookup                                       │
│  Strip /gateway prefix → match against in-memory route cache │
│  Exact match (O(1)) or wildcard match (longest prefix)      │
│  If no match → 404 ROUTE_NOT_FOUND                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: Service Load                                       │
│  Fetch service config from PostgreSQL by route.service_id    │
│  If service disabled or missing → 503 SERVICE_DISABLED      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 3: API Key Auth (if route.api_key_required)           │
│  Parse X-API-Key header → SHA-256 hash → DB lookup           │
│  Check enabled + not expired                                 │
│  If invalid → 401 INVALID_API_KEY                           │
│  Per-key rate_limit_per_min overrides route default           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 3.5: JWT Auth (if route.auth_required)                │
│  Parse Authorization: Bearer <token>                         │
│  Verify signature (HS256), expiry, issuer, audience          │
│  Verify type claim === 'access' (prevents token confusion)   │
│  Strip Authorization header before forwarding to upstream     │
│  If invalid → 401 UNAUTHORIZED                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 4: Rate Limit                                         │
│  Identity: apiKeyId || req.ip || 'anon'                      │
│  Redis INCR per-minute + per-hour bucket                     │
│  EXPIRE only on first creation (prevents TTL reset leak)     │
│  If exceeded → 429 RATE_LIMITED + X-RateLimit-* headers     │
│  Fails open on Redis error (degraded mode)                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 5: Cache Lookup (GET/HEAD only, if cache_ttl > 0)    │
│  Build key: cache:r:{routeId}:{method}:{url}                 │
│  Redis GET → if hit: return cached response (X-Cache: HIT)  │
│  If miss: continue to proxy (X-Cache: MISS)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 6: Load Balancer                                      │
│  Filter healthy targets from service.upstream_targets        │
│  If no healthy targets → 503 NO_HEALTHY_UPSTREAM            │
│  Select via smooth weighted round-robin (nginx algorithm)    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 7: Circuit Breaker                                    │
│  Check per-upstream state: CLOSED / OPEN / HALF_OPEN         │
│  If OPEN → 503 CIRCUIT_OPEN                                 │
│  If HALF_OPEN and max probes reached → 503 CIRCUIT_OPEN     │
│  State persisted to PostgreSQL (survives restarts)           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 8: Path Rewrite                                       │
│  If strip_prefix: remove route.public_path from request      │
│  Prepend route.upstream_path                                 │
│  Append query string                                         │
│  Example: /xcode/user/login → /user/login                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 9: Reverse Proxy                                      │
│  Set forwarding headers (X-Forwarded-*, X-EdgeFlow-*)        │
│  proxy.web(req, res, { target }) via http-proxy              │
│  selfHandleResponse: true — buffer response for caching      │
│  proxyReq event: fix body if consumed, strip Transfer-Encoding│
│  Retry once on connection error (configurable)               │
│  Record circuit breaker success/failure based on status code │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 10: Record Log                                        │
│  INSERT into request_logs (fire-and-forget)                  │
│  UPSERT into analytics (per-minute per-service rollup)       │
│  Pipeline stages JSON-encoded for visualizer                 │
└─────────────────────────────────────────────────────────────┘
```

## Response Handling

The `proxyRes` event handler:
1. Collects all response chunks into a Buffer
2. Strips hop-by-hop headers (RFC 7230 §6.1)
3. Sets `X-Cache: MISS` on cacheable routes
4. Writes response to client
5. If 2xx GET and cacheable: stores response in Redis (base64 body, fire-and-forget)

## Error Response Shape

All errors return a consistent JSON shape:

```json
{
  "success": false,
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "No route registered for GET /unknown/path",
    "details": null
  }
}
```
