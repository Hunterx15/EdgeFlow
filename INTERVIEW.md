# 🎤 EdgeFlow — Interview Preparation

> 30 interview questions and detailed answers covering every engineering decision in EdgeFlow. Designed to be confidently discussed for 20–30 minutes during an SDE interview.

## Table of Contents

1. [Resume Bullet](#-resume-bullet)
2. [Project Summary](#-project-summary)
3. [System Architecture](#-system-architecture)
4. [Design Decisions](#-design-decisions)
5. [Trade-offs](#-trade-offs)
6. [Future Improvements](#-future-improvements)
7. [30 Interview Questions & Answers](#-30-interview-questions--answers)

---

## 📄 Resume Bullet

> **EdgeFlow — Production-Inspired API Gateway** (Node.js · Express · PostgreSQL · Redis · React 19)
>
> Built an original API gateway from scratch that proxies traffic to multiple backend services with a 10-stage request pipeline (route lookup → rate limit → cache → circuit breaker → load balancer → reverse proxy). Implemented JWT auth with refresh-token rotation, opaque API keys (SHA-256 hashed), Redis sliding-window rate limiting, weighted round-robin load balancing, three-state circuit breaker, and per-minute analytics rollups. Designed a React 19 dashboard with a built-in Postman-like API playground, animated request pipeline visualizer, gateway timeline, and service dependency graph. Containerized with Docker Compose; ~10K LOC across 100+ files.

---

## 📝 Project Summary

EdgeFlow is a lightweight, production-inspired API Gateway that sits in front of multiple backend services. It centralizes cross-cutting concerns — routing, authentication, rate limiting, caching, analytics, circuit breaking, and monitoring — behind a single Express app. The frontend is a modern dark-theme React 19 dashboard with 12 pages including five special features: an API Playground, an animated Request Pipeline Visualizer, a Gateway Timeline, a Service Dependency Graph, and a Live Metrics Dashboard.

The project intentionally uses a simpler architecture than traditional gateways: **Routes → Controllers → Services → Database** (no repository pattern). Services talk to PostgreSQL directly via the shared `pg` Pool. This reduces indirection and is easier to reason about for a single-process gateway with limited entity types.

The gateway engine runs 10 stages per proxied request, recording each stage's duration in a `pipeline_stages` JSONB column so the dashboard can render real timings. All the hard problems — circuit breaking, rate limiting, cache invalidation, load balancing, retry-once — are implemented from scratch using battle-tested algorithms (nginx's smooth weighted round-robin, Cloudflare's fixed-window rate-limit approximation, Netflix Hystrix's three-state circuit breaker).

---

## 🏗 System Architecture

```
                                 ┌─────────────────────────────────────────────────────────────┐
                                 │                    EDGEFLOW (the gateway)                    │
  ┌──────────┐    HTTP/S         │  ┌────────────────────┐    ┌────────────────────────┐       │
  │  Client  │ ─────────────────▶│  │  Admin REST API     │    │   Gateway Proxy Engine │       │
  │ (browser │                   │  │  /api/v1/*          │    │   /gateway/*           │       │
  │  / curl  │                   │  │  (auth, services,   │    │  (10-stage pipeline:   │       │
  │  / app)  │                   │  │   routes, ...)      │    │   route → service →    │       │
  └──────────┘                   │  └────────┬───────────┘    │   API key → rate limit │       │
       ▲                         │           │                │   → cache → LB → CB    │       │
       │  response               │  ┌────────▼──────────────┐ │   → proxy → response)  │       │
       │                         │  │  Services (business   │ └──────────┬─────────────┘       │
       │                         │  │  logic + DB access)   │            │                     │
       │                         │  └────────┬──────────────┘            │                     │
       │                         │           │                           │                     │
       │                         │  ┌────────▼────────┐    ┌────────────▼────────────┐        │
       │                         │  │  pg Pool        │    │  Redis                  │        │
       │                         │  │  (PostgreSQL)   │    │  (cache + rate-limit +  │        │
       │                         │  └─────────────────┘    │   circuit-breaker state)│        │
       │                         └──────────────────────────┴─────────────────────────┘        │
       │                                                                                         │
       │                              ┌─────────────────────┐         ┌──────────────────┐     │
       └──────────────────────────────│   PostgreSQL 16     │         │  Upstream        │     │
                                      │  (config + logs +   │         │  services        │     │
                                      │   analytics)        │         │  (your backends) │     │
                                      └─────────────────────┘         └──────────────────┘     │
```

### Simpler Architecture (no Repository Pattern)

```
Routes          → Express routers (HTTP endpoint definitions)
Middlewares     → auth, validation, logging, rate limit, cache, error wrap
Controllers     → HTTP req/res orchestration (no business logic)
Services        → business logic + DB access (uses pg Pool directly)
Database        → PostgreSQL + Redis
```

**Dependency rule:** outer layers may depend on inner layers, never the reverse.

---

## 🎯 Design Decisions

1. **Simpler architecture (no repository pattern)** — For a single-process gateway with limited entity types, the repository layer adds indirection without adding testability or flexibility. Services use parameterized queries directly via the shared pg Pool.

2. **PostgreSQL over MongoDB** — Gateway config (services, routes, API keys) is highly relational. Foreign keys, unique constraints, transactions, JSONB for semi-structured fields (upstream_targets, scopes), and `PERCENTILE_CONT` for P95 latency analytics.

3. **Redis with in-memory fallback** — O(1) cache + atomic INCR for rate-limit counters. Falls back to a Map if Redis is down so the gateway stays functional (logged loudly).

4. **JWT (access + refresh) for admins, opaque API keys for consumers** — Mirrors how Stripe / GitHub PATs work. Access tokens are stateless (15m). Refresh tokens are tracked by `jti` in PG (7d) with rotation on every refresh to detect replay attacks.

5. **Bcrypt for passwords, SHA-256 for API keys** — Bcrypt for low-entropy human passwords. SHA-256 for high-entropy machine credentials (32 bytes random) — fast hash is safe, O(log n) lookup needed.

6. **Smooth weighted round-robin** — Same algorithm as nginx. Produces a smooth distribution (weights 5:1 → every 6th request goes to the second target, never a burst of 5 in a row).

7. **Three-state circuit breaker (CLOSED/OPEN/HALF_OPEN)** — Classic Netflix Hystrix pattern. State mirrored to PG so it survives restarts and is shared across replicas.

8. **Sliding-window approximation for rate limiting** — Two Redis counters (per-minute + per-hour) using INCR + EXPIRE. Single round-trip via pipelining. "Good enough" for most API gateway use cases — much cheaper than a true sliding window (sorted set per identity).

9. **Fail-open rate limiting** — If Redis is down, let traffic through (logged loudly). A Redis outage should NOT take down every backend service behind the gateway. The circuit breaker catches downstream issues.

10. **Retry-once on upstream failure** — Per the requirements. If the first attempt fails, mark the target as failed (circuit breaker counts it), back off 200ms, and try the next healthy target. Bounded retries prevent retry storms.

11. **Per-stage pipeline timing** — Each proxied request records its 10-stage durations in a `pipeline_stages` JSONB column. Powers the Pipeline Visualizer + Timeline features with real data instead of mocks.

12. **In-house migration runner** — Tiny runner that tracks applied migrations in a `schema_migrations` table. No external migration tool needed. Each migration runs in a transaction.

---

## ⚖️ Trade-offs

| Decision | Pro | Con |
| --- | --- | --- |
| No repository pattern | Fewer files, less indirection, easier to reason about | Harder to swap databases; SQL scattered across services |
| PostgreSQL over MongoDB | Relational integrity, transactions, JSONB, PERCENTILE_CONT | Vertical scaling limits; need partitioning at scale |
| Redis with in-memory fallback | Gateway stays functional when Redis is down | Multi-instance deployments lose accuracy in fallback mode |
| Fixed-window rate limit | O(1) per request, single Redis round-trip | Slight over-limit at window boundaries (a client could do 2x limit at minute boundary) |
| Fail-open rate limiting | Redis outage doesn't take down all backends | A misbehaving client could exceed limits during Redis outage |
| Retry-once (not retry-N) | Bounded retries prevent retry storms | One retry might not be enough for transient network blips |
| JWT access tokens stateless | No DB lookup per request, fast verification | Can't revoke instantly (must wait for expiry, ~15m) |
| SHA-256 for API keys | O(log n) lookup, ~0ms per verification | Not brute-force resistant — but keys are 32 random bytes, so brute-force is infeasible anyway |
| In-memory route cache | Sub-microsecond lookups, no Redis round-trip | Per-instance cache; route changes propagate in up to 60s |
| Three-state circuit breaker | Tests the waters before re-enabling traffic | More complex than two-state; HALF_OPEN edge cases |
| Pipeline stages as JSONB | Self-documenting, flexible schema | Slightly more storage than fixed columns; can't index inside JSON easily |

---

## 🚧 Future Improvements

- **WebSocket proxying** — `http-proxy` supports it; needs a separate upgrade handler.
- **gRPC support** — currently HTTP-only.
- **JWT blacklist** — for instant access-token revocation on logout / password change.
- **Audit log** — separate from `request_logs`, records admin actions (service created, route deleted, API key revoked).
- **Prometheus metrics** — `/metrics` endpoint with `http_requests_total`, `http_request_duration_seconds`, etc.
- **OTLP tracing** — OpenTelemetry spans propagated to upstreams via `traceparent` header.
- **Multi-tenancy** — add `organization_id` to every table for SaaS use.
- **Columnar log storage** — ship `request_logs` to ClickHouse after 24h to keep Postgres lean.
- **Token-bucket rate limiting** — for smoother limits than fixed-window.
- **Per-instance rate-limit bypass** — let admin temporarily raise a key's limit without a DB write.
- **Plugin system** — Express middleware factories loaded dynamically from a `plugins/` directory.

---

## 🎤 30 Interview Questions & Answers

### Q1: Why use an API Gateway at all? Why not let clients call backend services directly?

**A:** Without a gateway, every backend service has to reimplement the same cross-cutting concerns: auth, rate limiting, logging, metrics, CORS, TLS termination. With 5+ services this becomes unsustainable — duplication, drift, security holes. A gateway centralizes these concerns in one place so backend services focus on business logic. Clients talk to one stable entry point; we can split/merge backend services without breaking clients. EdgeFlow does this with a single Express app that proxies via `http-proxy`.

---

### Q2: Walk me through what happens when a request hits `/gateway/users/123`.

**A:** 10 stages:
1. **Route Lookup** — in-memory cache matches the URL against the routes table.
2. **Service Load** — fetch the target service + its upstream targets from PostgreSQL.
3. **API Key Auth** — if the route requires it, validate the `X-API-Key` header.
4. **Rate Limit** — Redis sliding-window counter (per-minute + per-hour).
5. **Cache Lookup** — for GET routes with `cache_ttl_sec > 0`, check Redis.
6. **Load Balancer** — smooth weighted round-robin picks the next healthy upstream.
7. **Circuit Breaker** — skip if OPEN, probe if HALF_OPEN, allow if CLOSED.
8. **Path Rewrite** — strip the gateway prefix, apply the upstream_path template.
9. **Reverse Proxy** — forward via `http-proxy` with retry-once on failure.
10. **Response + Log** — fire-and-forget write to Postgres (request_logs + analytics rollup).

Each stage's duration is recorded in `request_logs.pipeline_stages` so the dashboard can render real timings.

---

### Q3: Why PostgreSQL over MongoDB?

**A:** Gateway config (services, routes, API keys) is highly relational and benefits from foreign keys, unique constraints, and transactions. We use JSONB for the few semi-structured fields (upstream_targets, metadata, scopes). Postgres also gives us `PERCENTILE_CONT` for P95 latency analytics and window functions for time-bucket rollups. MongoDB would force us to emulate relational integrity in app code.

---

### Q4: Why Redis? What happens if Redis goes down?

**A:** Redis gives us O(1) response cache + sliding-window rate-limit counters + circuit-breaker state shared across replicas. If Redis is unreachable, EdgeFlow falls back to an in-memory `Map`-based shim so the gateway keeps serving traffic (logged loudly). In multi-instance deployments this loses accuracy (cache hit rate drops to ~0%, rate-limit counters diverge between instances), so we alert on fallback mode. The `/monitoring/ready` endpoint returns `redis.fallback = true` and the overall status becomes "degraded".

---

### Q5: How does JWT verification work? Why two tokens?

**A:** Access tokens are short-lived (15m) and stateless — verified with `jsonwebtoken` using HS256. No DB lookup needed. Refresh tokens are long-lived (7d) and tracked by `jti` (JWT ID) in PostgreSQL. On every refresh we issue a new refresh token AND invalidate the previous one by updating `users.refresh_token_jti`. This detects token theft: if a stolen refresh token is replayed after the legitimate user has refreshed, the jti won't match → 401 + revoke all sessions for that user. This is the same pattern described in RFC 6749 §10.4 (refresh token rotation).

---

### Q6: How are API keys stored? Why SHA-256 and not bcrypt?

**A:** The key has two parts: a public `key_id` (`ef_live_xxx`) and a secret. We store only `SHA-256(secret)` — never the plaintext. SHA-256 is safe here because the secret is 32 bytes of cryptographic random, so brute-force is infeasible even with a fast hash. We use SHA-256 (not bcrypt) because API key verification needs O(log n) lookup by `(key_id, key_hash)` via a unique index, and bcrypt would add ~250ms per authenticated request. Bcrypt is for low-entropy human passwords; SHA-256 is fine for high-entropy machine credentials. This mirrors how Stripe and GitHub personal access tokens work.

---

### Q7: How does the reverse proxy work?

**A:** We use `http-proxy` (the same library that powers `http-proxy-middleware`). After the route is matched and the upstream target is picked, we set `x-edgeflow-*` and `x-forwarded-*` headers, rewrite `req.url` to the upstream path, and call `proxy.web(req, res, { target: baseUrl })`. On error, we mark the target as failed (circuit breaker counts it), back off 200ms, and try the next healthy target — up to 1 retry (per the requirements). On success, we record the response status + size and write to `request_logs`.

---

### Q8: How does load balancing work?

**A:** Smooth weighted round-robin (the same algorithm nginx uses). Each target has a `weight` (configured) and a `currentWeight` (mutable). On each call: (1) add `weight` to `currentWeight` for every target, (2) pick the target with the highest `currentWeight`, (3) subtract total weight from the picked target's `currentWeight`. This produces a smooth distribution (weights 5:1 → every 6th request goes to the second target, never a burst of 5 in a row). Unhealthy targets are filtered out before selection by the health scheduler.

---

### Q9: How does the circuit breaker work? Why three states?

**A:** Per-upstream-URL state machine:
- **CLOSED** → traffic flows; failures increment a counter. At threshold (5) → OPEN.
- **OPEN** → fail fast with 503. After `openStateMs` (30s) → HALF_OPEN.
- **HALF_OPEN** → allow up to 3 probe requests. 2 successes → CLOSED; any failure → OPEN again.

The three states let us "test the waters" before committing to fully re-enabling traffic. Without HALF_OPEN we'd either flip-flop (CLOSED → OPEN → CLOSED on the next success) or stay OPEN too long. State is kept in memory for hot reads AND mirrored to PostgreSQL so it survives restarts and is shared across replicas.

---

### Q10: How does rate limiting work? Why "fail open"?

**A:** Sliding-window approximation: per `(identity, route)` we keep two Redis counters — a per-minute bucket and a per-hour bucket. Single PIPELINE: `INCR minute_key; EXPIRE 70; INCR hour_key; EXPIRE 3700`. If `minute_count > limit_per_min` OR `hour_count > hour_limit` → 429 + `Retry-After: 60`.

"Fail open" means if Redis is down we let traffic through (logged loudly). Rationale: a Redis outage should NOT take down every backend service behind the gateway. The circuit breaker catches downstream issues. The trade-off is that a misbehaving client could exceed limits during a Redis outage, but that's better than the gateway becoming a single point of failure.

---

### Q11: How does caching improve latency?

**A:** For GET routes with `cache_ttl_sec > 0`, we cache the response in Redis keyed by `route+method+url`. Subsequent identical requests get a HIT (~1ms) instead of a round-trip to the backend (~50-500ms). Only 2xx responses are cached. The `X-Cache: HIT` header is set on cached responses. Non-GET requests (POST/PUT/DELETE) automatically invalidate the cache for that path. Cache hit rate shows on the dashboard.

---

### Q12: Why a simpler architecture (no repository pattern)?

**A:** For a single-process gateway with a limited number of entity types, the repository pattern adds indirection without adding testability or flexibility. Services use parameterized queries directly via the shared `pg` Pool. This is easier to reason about, has fewer files, and is simpler to explain in interviews. The repository pattern shines when you have many entity types, need to swap databases, or want to enforce a strict boundary between SQL and business logic — none of which apply to EdgeFlow.

---

### Q13: How does health checking work?

**A:** A scheduler keeps one `setInterval` per enabled service. Each tick pings every upstream target's `health_check_path` with a 5s timeout using Node's `http.get` / `https.get`. A target is healthy if the response is 2xx/3xx. We require `unhealthyThreshold` (3) consecutive failures before flipping the service to `unhealthy` — this prevents flapping when a single check fails transiently. The load balancer only routes to `healthy === true` targets.

---

### Q14: What happens when a service is unavailable?

**A:** Three layers of defense:
1. **Health scheduler** — marks unhealthy upstreams every 30s; the load balancer skips them.
2. **Retry-once** — if a request still fails, we retry against the next healthy target (after a 200ms backoff).
3. **Circuit breaker** — if failures exceed the threshold (5), the circuit opens and we fail fast with 503 until the open-state timeout (30s) elapses, then we probe via HALF_OPEN.

---

### Q15: How are passwords hashed? Why bcrypt at cost 12?

**A:** `bcrypt` at cost factor 12 (~250ms per hash on a 2024 CPU). Bcrypt has a built-in salt so we don't manage salts manually. Cost factor scales with hardware — 12 is the sweet spot in 2024+ (safe against brute-force, but not so slow it makes the login UI lag). On login, if the stored hash has a lower cost factor than the current config, we transparently re-hash on the fly via `needsRehash()`. For a brand-new product in 2025+ I would pick argon2id, but bcrypt is universally understood and Good Enough.

---

### Q16: How does the dashboard authenticate API requests?

**A:** The frontend stores the access token in `localStorage`. An Axios interceptor attaches it as `Authorization: Bearer <token>` on every request. On 401, the interceptor transparently calls `/auth/refresh` (the refresh token is in an httpOnly cookie so it's sent automatically), gets a new access token, and retries the original request. If refresh fails, the user is redirected to `/login`.

---

### Q17: How would you scale EdgeFlow horizontally?

**A:** EdgeFlow is stateless (per-instance) for HTTP traffic. Run N replicas behind a TCP load balancer (AWS ALB, nginx, HAProxy). All replicas share the same PostgreSQL + Redis:
- Rate-limit counters and cache are shared via Redis (no divergence).
- Circuit-breaker state is mirrored to PostgreSQL (eventually consistent).
- Health checks run on every replica — a bit wasteful but harmless.
- The in-memory route cache is per-instance; route changes propagate in up to 60s.

---

### Q18: Why retry-once instead of retry-N?

**A:** Per the requirements. Bounded retries prevent retry storms: if every gateway retries 3x and there are 5 replicas, a single client request can amplify to 5 × 4 = 20 upstream requests, which can take down a struggling backend. Retry-once is enough to handle transient network blips while keeping amplification bounded. Combined with the circuit breaker, retry-once is sufficient — if both attempts fail, the circuit will start opening.

---

### Q19: How do you handle path rewriting?

**A:** Each route has a `public_path` (e.g. `/gateway/users/*`), an `upstream_path` (e.g. `/api/users`), and a `strip_prefix` flag. When a request comes in at `/gateway/users/123`, the path rewriter strips the public prefix (`/gateway/users`) and prepends the upstream_path, preserving the suffix (`/123`) and query string. Result: `/api/users/123?q=...`. Edge cases like double-slashes are handled. Wildcard routes (ending in `/*`) match by longest-prefix.

---

### Q20: How does the pipeline visualizer get its data?

**A:** Every proxied request records its 10-stage durations in a `pipeline_stages` JSONB column on `request_logs`. The proxy engine wraps each stage in a `stage()` helper that captures the start time, runs the function, and records the duration + success/error. The `/api/v1/logs/timeline` endpoint returns recent logs with their `pipeline_stages` array. The Pipeline Visualizer page lets you pick a log and animate through each stage with its real timing.

---

### Q21: How does the refresh token rotation detect replay attacks?

**A:** On every refresh, we issue a new refresh token with a new random `jti` (JWT ID) and update `users.refresh_token_jti` in PostgreSQL. If an attacker steals a refresh token and replays it AFTER the legitimate user has refreshed, the `jti` won't match what's stored on the user row → 401 + revoke all sessions for that user. The trade-off is that if the legitimate user has two tabs open and one refreshes, the other tab's refresh token is now invalid — but they'll just get a 401 and silently re-authenticate via the cookie.

---

### Q22: Why does the gateway log to PostgreSQL instead of a dedicated log system?

**A:** For an interview-grade project, Postgres is enough — it's already there, it's transactional, and we can query it with SQL. In production you'd want to ship `request_logs` to a columnar store (ClickHouse, BigQuery) after 24-48h to keep Postgres lean. The `analytics` table (per-minute rollups) is small and stays in Postgres indefinitely. EdgeFlow's `analyticsService.cleanup()` provides the cleanup hook for old rollups.

---

### Q23: How do you prevent SQL injection?

**A:** Every query uses parameterized placeholders (`$1`, `$2`, ...) via the `pg` library. User input NEVER goes into the query string directly. The `pg` library handles escaping. We also validate input at the route layer using the `validate.body()` / `validate.query()` middleware with explicit schemas that check types, lengths, and formats.

---

### Q24: What's the difference between the `/health` and `/monitoring/ready` endpoints?

**A:** `/health` is a **liveness probe** — it returns `{ status: 'ok' }` as long as the process is up. Used by Docker / load balancers to decide whether to kill the pod. `/api/v1/monitoring/ready` is a **readiness probe** — it pings PostgreSQL, Redis, the service registry, and the circuit breakers, and returns 503 if any critical subsystem is down. Used by load balancers to decide whether to route traffic to this instance.

---

### Q25: How would you implement WebSocket proxying?

**A:** `http-proxy` supports it via `proxy.ws(req, socket, head, { target })`. We'd add a separate `server.on('upgrade', ...)` handler in `server.js` that runs the same route lookup + auth + circuit breaker logic, then calls `proxy.ws()`. The tricky parts are: (1) JWT auth on the upgrade request (usually via query param since browsers can't set headers on WebSocket connections), (2) connection draining on shutdown (close the HTTP server first, then wait for sockets to drain).

---

### Q26: How do you handle CORS?

**A:** We use the `cors` middleware with a whitelist from `CORS_ORIGINS`. Credentials are allowed (for the httpOnly refresh cookie). The middleware sets `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, and `Access-Control-Expose-Headers` (for `X-Request-Id`, `X-RateLimit-*`, `X-Cache`). Preflight (`OPTIONS`) requests are handled automatically.

---

### Q27: How would you add Prometheus metrics?

**A:** Add a `/metrics` endpoint that returns Prometheus text format. Key metrics:
- `edgeflow_requests_total{method, route, status}` — counter
- `edgeflow_request_duration_seconds{method, route}` — histogram
- `edgeflow_cache_hits_total` / `edgeflow_cache_misses_total` — counters
- `edgeflow_circuit_breaker_state{upstream_url, state}` — gauge (1 if in state, 0 otherwise)
- `edgeflow_active_requests` — gauge
- `edgeflow_redis_memory_used_bytes` — gauge

We'd use `prom-client` for the underlying metric types. The middleware pipeline would record request counts + durations; the cache service would record hits/misses; the circuit breaker would expose its state.

---

### Q28: What's the smooth weighted round-robin algorithm? Walk through an example.

**A:** Each target has `weight` (configured) and `currentWeight` (mutable, starts at 0). On each call:
1. Add `weight` to `currentWeight` for every target.
2. Pick the target with the highest `currentWeight`.
3. Subtract `total_weight` from the picked target's `currentWeight`.

Example with weights A=5, B=1 (total=6):
- Call 1: A.cw=5, B.cw=1. Pick A (highest). A.cw = 5-6 = -1. → A
- Call 2: A.cw=4, B.cw=2. Pick A. A.cw = 4-6 = -2. → A
- Call 3: A.cw=3, B.cw=3. Pick A (tie goes to first). A.cw = 3-6 = -3. → A
- Call 4: A.cw=2, B.cw=4. Pick B. B.cw = 4-6 = -2. → B
- Call 5: A.cw=7, B.cw=-1. Pick A. A.cw = 7-6 = 1. → A
- Call 6: A.cw=6, B.cw=0. Pick A. A.cw = 6-6 = 0. → A

Pattern: A,A,A,B,A,A — 5:1 distribution, no burst.

---

### Q29: How do you test the gateway?

**A:** Three layers:
1. **Unit tests** — services are tested in isolation by passing a fake `pg` Pool (jest mocks).
2. **Integration tests** — `supertest` against the Express app with a test PostgreSQL + Redis (docker-compose override).
3. **End-to-end tests** — boot the full docker-compose stack, register a service pointing at the demo-service, send requests through `/gateway/*`, and assert on the response + the log entries.

The `demo-service` in `docker/demo-service/` is a tiny Express echo server that makes e2e tests easy — it returns the headers it received so you can verify `x-edgeflow-*` headers are set correctly.

---

### Q30: What's the hardest bug you'd anticipate in this codebase?

**A:** The retry-once logic in `proxyEngine.js` is the trickiest part. The challenges:
1. **Response stream hijacking** — we monkey-patch `res.write` / `res.end` / `res.writeHead` to capture status + size for logging. If the response has already started streaming, we can't retry — the client would see corrupted output. We check `res.headersSent` before retrying.
2. **Circuit breaker bookkeeping** — a 5xx response should count as a failure, but a 4xx should not (it's the client's fault). We check `status >= 500` before calling `recordFailure`.
3. **Race conditions** — if the client disconnects mid-request, we still need to record the log. We listen for `res.on('finish')` and `res.on('error')`.
4. **Pipeline stage timing** — each stage's duration must be measured with `process.hrtime.bigint()` (nanosecond precision) to avoid `Date.now()` drift under heavy load.

The other hard problem is the HALF_OPEN state — if multiple concurrent requests enter HALF_OPEN simultaneously, we need to track `halfOpenInflight` correctly or we'll allow more probes than configured.
