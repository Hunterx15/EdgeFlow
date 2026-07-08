# EdgeFlow - Redis Flow

Redis is used for three things: response cache, rate-limit counters, and
circuit-breaker state (mirrored). All three flows fall back to an
in-memory Map if Redis is unreachable.

## 1. Response Cache

```
Request arrives at /gateway/users/123 (GET, cache_ttl_sec=60)
  │
  ▼
cacheService.buildCacheKey({ routeId, method, originalUrl })
  │
  │  key = "cache:r:<routeId>:GET:/gateway/users/123"
  ▼
Redis GET key
  │
  ├─── HIT ───► Return cached { status, headers, body }
  │              Set X-Cache: HIT, X-Cache-TTL: 60
  │              Skip stages 6-9 (no upstream call!)
  │
  └─── MISS ──► Continue to Load Balancer + Circuit Breaker + Proxy
                 │
                 │ On 2xx response:
                 ▼
                 Redis SET key { status, headers, body } EX 60
                 Set X-Cache: MISS
                 Return response to client
```

### Cache invalidation

- **TTL-based:** every cached entry auto-expires after `cache_ttl_sec`.
- **Manual:** dashboard `POST /api/v1/monitoring/cache/flush` flushes everything.
- **Pattern:** dashboard `POST /api/v1/monitoring/cache/invalidate { pattern: 'cache:r:*' }` uses SCAN + DEL.
- **Implicit:** non-GET requests (POST/PUT/DELETE) to a path invalidate the GET cache for that path.

## 2. Rate Limiting (sliding-window approximation)

```
Request arrives at /gateway/users/123 (rate_limit_per_min = 100)
  │
  ▼
identity = apiKeyId || req.ip || 'anon'
now = Math.floor(Date.now() / 1000)
minuteBucket = Math.floor(now / 60)
hourBucket = Math.floor(now / 3600)

minuteKey = "rl:<identity>:<routeId>:60:<minuteBucket>"
hourKey   = "rl:<identity>:<routeId>:3600:<hourBucket>"
  │
  ▼
Redis PIPELINE:
  INCR minuteKey           → minuteCount
  EXPIRE minuteKey 70
  INCR hourKey             → hourCount
  EXPIRE hourKey 3700
EXEC
  │
  ├─── minuteCount > 100 OR hourCount > 5000 ───► 429 Too Many Requests
  │                                                Set Retry-After: 60
  │
  └─── Both within limits ───────────────────────► Continue
                                                    Set X-RateLimit-Limit
                                                    Set X-RateLimit-Remaining
```

**Fail-open policy:** if Redis is unreachable, we let the request through (logged loudly). A Redis outage should NOT take down every backend service behind the gateway. The circuit breaker catches downstream issues.

## 3. Circuit Breaker State (mirror)

```
                    ┌─────────────────────────────────────┐
                    │  In-memory Map (hot path reads)     │
                    │  state[upstreamUrl] = {             │
                    │    state: 'closed' | 'open' |      │
                    │            'half_open',             │
                    │    failureCount, successCount,      │
                    │    openedAt, halfOpenInflight       │
                    │  }                                  │
                    └────────────┬────────────────────────┘
                                 │
                  state transitions (only)
                                 │
                                 ▼
                    ┌─────────────────────────────────────┐
                    │  PostgreSQL circuit_breaker_state   │
                    │  (survives restarts, shared         │
                    │   across replicas)                  │
                    └─────────────────────────────────────┘
```

- **Reads** (every proxied request): from in-memory Map — O(1), no I/O.
- **Writes** (state transitions only): fire-and-forget UPSERT to PostgreSQL.
- **Boot:** loadPersistedState() reads all rows from `circuit_breaker_state` and populates the in-memory Map.

## 4. Fallback Mode (when Redis is down)

```
Redis connection fails
  │
  ▼
redis.getClient() returns MemoryFallback instance
  │
  ├── Logger warns: "redis: running in MEMORY FALLBACK mode"
  │
  ├── cacheService: uses Map (single-instance only)
  ├── rateLimiter:  uses Map (per-process, not shared)
  └── circuitBreaker: unaffected (uses in-memory Map anyway)
  │
  ▼
/monitoring/ready shows redis.fallback = true
  → status becomes "degraded"
  → dashboard shows warning badge
```

In a single-instance deployment the gateway keeps working in fallback mode. In a multi-instance deployment, cache hit rate drops to ~0% and rate-limit counters diverge between instances, so we alert on fallback mode.
