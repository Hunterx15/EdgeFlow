# 🎤 EdgeFlow — SDE Interview Preparation Guide

> 30 deep-dive technical interview questions and comprehensive answers covering every engineering decision, architectural trade-off, failure mode, and performance optimization in EdgeFlow. Designed to be confidently defended for 20–30 minutes during a Senior/Staff Software Engineer interview.

---

## 📑 Table of Contents

1. [Resume Snippet (LaTeX Formatted)](#-resume-snippet-latex-formatted)
2. [Empirical Benchmarks & Metrics Defense](#-empirical-benchmarks--metrics-defense)
3. [System Architecture & 10-Stage Pipeline](#-system-architecture--10-stage-pipeline)
4. [Core Architectural Design Decisions](#-core-architectural-design-decisions)
5. [Engineering Trade-offs & Alternatives](#-engineering-trade-offs--alternatives)
6. [30 Deep-Dive Interview Questions & Answers](#-30-deep-dive-interview-questions--answers)
   - [Category 1: Gateway Architecture & Proxy Engine (Q1–Q8)](#category-1-gateway-architecture--proxy-engine)
   - [Category 2: Distributed Resilience & Rate Limiting (Q9–Q14)](#category-2-distributed-resilience--rate-limiting)
   - [Category 3: Authentication, Security & Cryptography (Q15–Q21)](#category-3-authentication-security--cryptography)
   - [Category 4: High-Throughput I/O & Database Optimization (Q22–Q26)](#category-4-high-throughput-io--database-optimization)
   - [Category 5: Production Operations, Testing & Debugging (Q27–Q30)](#category-5-production-operations-testing--debugging)

---

## 📄 Resume Snippet (LaTeX Formatted)

```latex
\projectHeading
    {EDGEFLOW --- High-Performance API Gateway \& Reverse Proxy}
    {https://github.com/Hunterx15/EdgeFlow}
    {https://edgeflow.onrender.com}
\textit{Node.js, Express.js, React 19, PostgreSQL, Redis, Docker, Jest, Autocannon}

\begin{itemize}
    \resumeItem{Engineered a high-performance, production-grade API Gateway with a \textbf{10-stage request pipeline} handling dynamic routing, JWT/API-key authentication, Cloudflare sliding-window rate limiting, and smooth weighted round-robin load balancing.}

    \resumeItem{Implemented an in-memory \textbf{service and route cache} with atomic PostgreSQL warming, Redis key lookup caching (5-min TTL), and bounded-queue asynchronous log batching, cutting synchronous database pool contention by \textbf{98\%} on high-throughput proxy routes.}

    \resumeItem{Integrated an \textbf{in-memory response cache} and distributed Redis Pub/Sub three-state circuit breaker, achieving \textbf{269.5\% higher throughput} (3,665 to \textbf{13,540 req/s}) and \textbf{79.2\% lower p95 latency} (48 ms to \textbf{10 ms}) in 100-VU local benchmarks.}

    \resumeItem{Hardened security and reliability with multi-device refresh token rotation (5 JTIs), request body replay across retries, and failover routing; sustained \textbf{275,058 requests} over a 100-VU soak test at \textbf{0\% error rate} and \textbf{10 ms p95 latency}.}
\end{itemize}
```

---

## ⚡ Empirical Benchmarks & Metrics Defense

These metrics were empirically measured using `autocannon` (`backend/scripts/benchmark.js`) simulating 100 Virtual Users (VU) against an upstream microservice with standard 5ms response latency:

### Verified Test Results

| Test Scenario | Concurrency (VU) | Throughput | Mean Latency | p95 Latency | p99 Latency | Error Rate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Full Reverse Proxy (Cache MISS)** | 100 connections | **3,664.8 req/s** | 26.86 ms | 48.00 ms | 69.00 ms | **0.00%** |
| **Redis Response Cache (Cache HIT)** | 100 connections | **13,540.0 req/s** | 6.88 ms | 10.00 ms | 12.00 ms | **0.00%** |
| **High-Load Soak Test (20 seconds)** | 100 connections | **13,754.0 req/s** | 6.74 ms | 10.00 ms | 13.00 ms | **0.00%** |

### How to Defend These Numbers in an Interview

#### Q: "Why did throughput increase by 269.5% from 3,665 to 13,540 req/s?"
> **Answer:** On a cache miss, every request traverses the full proxy pipeline: route matching, service lookup, rate limiting, load balancing, TCP socket establishment to the upstream microservice, HTTP header serialization, waiting 5ms for upstream processing, stream piping, and micro-batched log ingestion. Under 100 concurrent connections, Node.js event loop time is split across multiple socket I/O events.
>
> On a cache hit, the response is retrieved directly from Redis / in-memory cache in sub-millisecond time. The gateway immediately terminates the request and streams the pre-serialized payload without touching the network stack to the upstream service. This eliminates upstream connection pool contention and frees the Node event loop, scaling throughput from 3,665 to 13,540 requests per second.

#### Q: "Why did p95 latency drop from 48 ms down to 10 ms?"
> **Answer:** Upstream network jitter, TCP handshake latency, and microservice execution queues create a long-tail latency distribution (p95 of 48 ms and p99 of 69 ms). By serving directly from Redis/memory on a cache hit, upstream queuing and network round-trips are eliminated. The p95 drops to 10 ms (a 79.2% reduction) and p99 drops from 69 ms to 12 ms (an 82.6% reduction).

#### Q: "How did you sustain 275,000 requests with 0.00% error rate during the soak test?"
> **Answer:** Three architectural optimizations eliminated bottlenecks:
> 1. **Zero Synchronous Database Hits on the Hot Path:** Routes and services are cached in memory (`routeCache` and `serviceCache`). API key validations are cached in Redis with 5-minute TTL.
> 2. **Decoupled Asynchronous Log Batching (`logBatcher`):** Request logs are collected in an in-memory queue and flushed via multi-row parameterized `INSERT`s (batches of 50 or every 1000ms) with bounded-queue backpressure (`MAX_QUEUE_SIZE = 2000`) preventing V8 heap exhaustion.
> 3. **Atomic Single-Roundtrip Rate Limiting:** Cloudflare sliding-window counters are evaluated via a single Redis `MULTI` transaction, preventing connection pool exhaustion.

---

## 🏗 System Architecture & 10-Stage Pipeline

EdgeFlow sits between clients and internal backend services:

```
[ Client Request ]
       │
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     EDGEFLOW PROXY ENGINE PIPELINE                     │
│                                                                        │
│  Stage 1: Route Lookup    ─── In-memory exact & wildcard Trie match    │
│  Stage 2: Service Load    ─── In-memory service cache (warmed on boot) │
│  Stage 3: API Key Auth    ─── Redis-cached SHA-256 verification (5m)   │
│  Stage 4: Rate Limiting   ─── Cloudflare sliding-window atomic MULTI   │
│  Stage 5: Cache Check     ─── Redis response cache (GET routes, TTL)   │
│  Stage 6: Load Balancing  ─── Smooth weighted round-robin              │
│  Stage 7: Circuit Breaker ─── CLOSED / OPEN / HALF_OPEN state machine  │
│  Stage 8: Path Rewriter   ─── Prefix strip & template interpolation    │
│  Stage 9: Reverse Proxy   ─── http-proxy with body replay on retry     │
│  Stage 10: Log Batching   ─── Bounded-queue async micro-batching       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        ┌───────────────────┐               ┌───────────────────┐
        │  PostgreSQL 16    │               │  Redis 7 Cache    │
        │  Config, Metrics, │               │  Rate Limiting,   │
        │  Rollup Analytics │               │  Pub/Sub Events   │
        └───────────────────┘               └───────────────────┘
```

---

## 🎯 Core Architectural Design Decisions

1. **Simpler Architecture (No Repository Pattern):**
   - For a single-process gateway with limited entity models, repository layers introduce unnecessary indirection without tangible testing gains. Services execute parameterized SQL queries directly via a shared `pg.Pool`, maximizing code readability and execution speed.
2. **PostgreSQL 16 for Relational Integrity:**
   - Gateway topologies require relational foreign keys (`services` → `routes` → `request_logs`), unique indexes for $O(\log n)$ key lookup, and `PERCENTILE_CONT` calculations for p95 latency analytics. Semi-structured targets are stored efficiently using `JSONB`.
3. **Redis 7 with In-Memory Map Fallback:**
   - Delivers sub-millisecond cache lookups and atomic counter increments. If Redis becomes temporarily unreachable, EdgeFlow falls back to an in-memory `Map` shim rather than crashing, upholding gateway availability.
4. **Dual Authentication Surfaces:**
   - **Admins:** Short-lived 15-minute HS256 JWT access tokens paired with 7-day `httpOnly` refresh tokens supporting multi-device rotation across up to 5 concurrent devices.
   - **Consumers:** Opaque API keys (`ef_live_<id>.<secret>`) verified by comparing SHA-256 hashes against indexed records, cached in Redis for 5 minutes.
5. **Smooth Weighted Round-Robin (nginx Algorithm):**
   - Eliminates request clustering by recalculating dynamic current weights on every invocation, distributing traffic smoothly even with heavily disparate weights (e.g. 5:1).
6. **Distributed Three-State Circuit Breaker:**
   - Prevents cascading microservice failures using Hystrix states (`CLOSED`, `OPEN`, `HALF_OPEN`). State transitions are broadcast cluster-wide via Redis Pub/Sub (`ef:circuit:events`).

---

## ⚖️ Engineering Trade-offs & Alternatives

| Decision | Chosen Approach | Alternative Considered | Engineering Justification |
| :--- | :--- | :--- | :--- |
| **Architecture Pattern** | Routes → Controllers → Services | Repository / Hexagonal Pattern | Repository indirection adds latency and file bloat for a high-performance proxy. |
| **Primary Database** | PostgreSQL 16 | MongoDB | Gateway config is relational; PostgreSQL provides foreign key cascading, ACID transactions, and native `PERCENTILE_CONT` analytics. |
| **Rate Limiting Algorithm** | Cloudflare Sliding-Window Approximation | Redis Sorted Sets (`ZSET`) | `ZSET` stores every request timestamp, consuming high memory and CPU ($O(\log N)$). Cloudflare sliding-window achieves smooth rate limits in 1 atomic MULTI round-trip. |
| **Fault Mode (Redis)** | Fail-Open | Fail-Closed | A caching layer outage must never take down mission-critical backend services. Circuit breakers catch downstream degradation. |
| **Upstream Retries** | Bounded Retry-Once (with alternate target) | Exponential Retry-N (3–5x) | Prevents retry storms where retrying gateway instances amplify traffic and crash recovering backends. |
| **Request Logging** | Decoupled Bounded Micro-Batcher | Synchronous SQL INSERT | Synchronous writes saturate database connection pools. Batching flushes 50 rows per query, reducing DB queries by 98%. |

---

## 🎤 30 Deep-Dive Interview Questions & Answers

### Category 1: Gateway Architecture & Proxy Engine

#### Q1: Why do we need an API Gateway? Why not call microservices directly?
**A:** Without an API gateway, every microservice must independently implement auth, rate limiting, logging, metrics, CORS, and TLS termination. With multiple services, this leads to code duplication, configuration drift, and security holes. An API gateway centralizes cross-cutting concerns into one place, decouples client applications from internal microservice topologies, and acts as a security and resilience boundary.

#### Q2: Walk me through what happens under the hood when a request hits `/gateway/users/123`.
**A:** The request passes through 10 sequential pipeline stages:
1. **Route Lookup:** Strips the `/gateway` mount prefix and queries the in-memory cache (`routeCache`) for `/users/123`, matching exact or wildcard route `/users/*`.
2. **Service Load:** Retrieves service metadata and upstream targets from `serviceCache` in memory.
3. **API Key Auth:** If required, checks `X-API-Key`, verifying the SHA-256 hash via Redis cache (`ef:apikey:<keyId>`).
4. **Rate Limit:** Runs Cloudflare sliding-window counter in Redis via atomic `MULTI` transaction.
5. **Response Cache:** For GET routes with TTL > 0, checks Redis for a cached response. On hit, returns immediately with `X-Cache: HIT`.
6. **Load Balancer:** Uses smooth weighted round-robin to select the next healthy upstream target.
7. **Circuit Breaker:** Inspects circuit breaker state for the selected target URL. Fails fast with 503 if OPEN.
8. **Path Rewrite:** Strips public route prefix, interpolates upstream path template, and retains query parameters.
9. **Reverse Proxy:** Pre-buffers request body and dispatches `proxy.web()`. On connection reset, retries once against an alternate healthy target.
10. **Response & Log Batching:** Streams response to client and pushes timing metadata to `logBatcher` and `analyticsService`.

#### Q3: How does EdgeFlow handle request body stream consumption when retrying failed requests?
**A:** In Node.js, standard readable HTTP streams can only be read once. If an upstream service connection resets mid-flight, retrying without stream buffering results in an empty payload or hanging connection. EdgeFlow solves this by pre-buffering incoming request bodies for non-GET requests (`readRequestBody(req)`). When `proxy.web()` fails on the first attempt, the buffered memory is transformed into a fresh `Readable` stream (`bufferToStream(bodyBuffer)`), the load balancer selects an alternate healthy target, and the request is safely retried.

#### Q4: How does the in-memory route cache work? How is cache invalidation handled?
**A:** Routes are stored in two in-memory collections: a `Map` for $O(1)$ exact path matches (`GET:/users/profile`) and an array sorted by path length descending for longest-prefix wildcard matches (`GET:/users/*`). Routes are warmed from PostgreSQL on boot. When an administrator creates, updates, or deletes a route via the REST API, `routeCache.invalidate()` is triggered, atomically re-querying active routes from PostgreSQL and rebuilding the cache.

#### Q5: How does the path rewriter transform `/gateway/users/42/details` to `/api/v1/users/42/details`?
**A:** The proxy engine strips the `/gateway` prefix, leaving `/users/42/details`. The matched route has `public_path = "/users/*"` and `upstream_path = "/api/v1/users"`. The rewriter strips the route prefix (`/users`), extracts the wildcard suffix (`/42/details`), and prepends the upstream path template, producing `/api/v1/users/42/details`. Any incoming query string (`?format=json`) is preserved.

#### Q6: How does EdgeFlow's load balancer distribute traffic across uneven upstream weights?
**A:** It implements nginx's smooth weighted round-robin algorithm. Each target maintains a static `weight` and a mutable `currentWeight`:
1. On each selection, add `weight` to `currentWeight` for every healthy target.
2. Select the target with the highest `currentWeight`.
3. Subtract the sum of all weights from the chosen target's `currentWeight`.
This guarantees a perfectly interleaved, burst-free distribution (e.g. weights 5:1 yields `A, A, A, B, A, A` rather than 5 consecutive requests to A).

#### Q7: What headers does EdgeFlow attach to proxied requests and why?
**A:**
- `X-EdgeFlow-Request-Id`: Unique UUID for distributed tracing across microservices.
- `X-EdgeFlow-Service-Id` & `X-EdgeFlow-Route-Id`: Identifies the routing rule that dispatched the request.
- `X-EdgeFlow-Upstream`: The specific backend target URL that received the request.
- `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`: Standard proxy forwarding headers.

#### Q8: How does the Request Pipeline Visualizer render microsecond stage timings?
**A:** The proxy engine wraps each stage execution in a timing helper using `process.hrtime.bigint()`. Nanosecond deltas are converted to floating-point milliseconds and recorded in a `pipeline_stages` array: `[{ name: 'route_lookup', duration_ms: 0.12, status: 'ok' }, ...]`. This array is stored in a `JSONB` column on `request_logs`. The React 19 frontend fetches the pipeline trace and renders an animated visualization showing stage transitions and exact execution durations.

---

### Category 2: Distributed Resilience & Rate Limiting

#### Q9: How does the three-state circuit breaker work?
**A:** EdgeFlow implements Netflix Hystrix's state machine:
- **CLOSED:** Normal operation. If 5 consecutive 5xx failures or timeouts occur within 10 seconds, the circuit trips to `OPEN`.
- **OPEN:** Requests fail fast immediately with HTTP 503 (`CIRCUIT_OPEN`), avoiding downstream queue build-ups.
- **HALF_OPEN:** After 30 seconds (`openStateMs`), the breaker enters `HALF_OPEN`, allowing up to 3 probe requests. If 2 consecutive probes succeed, the circuit resets to `CLOSED`; if any probe fails, it trips back to `OPEN`.

#### Q10: How do multiple EdgeFlow gateway instances synchronize circuit breaker states?
**A:** In a distributed multi-replica deployment, an in-memory circuit breaker only knows about errors on its own instance. EdgeFlow connects each gateway instance to Redis Pub/Sub on channel `ef:circuit:events`. When any instance detects a state transition (`CLOSED → OPEN` or `HALF_OPEN → CLOSED`), it publishes an event payload `{ upstreamUrl, state, timestamp }`. All subscriber instances immediately update their local circuit state, ensuring cluster-wide fault isolation in under 5ms.

#### Q11: Explain Cloudflare's sliding-window rate limiting algorithm. Why not use Redis Sorted Sets?
**A:** Redis Sorted Sets (`ZSET`) store each request timestamp as an individual member, requiring `ZREMRANGEBYSCORE`, `ZADD`, and `ZCARD` on every request. At 15,000 req/s, `ZSET` consumes significant memory and CPU.
Cloudflare's approximation maintains only two integer keys per identity: current minute bucket and previous minute bucket:

$$\text{Estimated Count} = \text{Current Bucket} + \text{Previous Bucket} \times \left( \frac{60 - \text{seconds elapsed}}{60} \right)$$

This is evaluated in a single atomic Redis `MULTI` transaction (`INCR currentKey`, `EXPIRE currentKey 120`, `GET previousKey`). It prevents 2x boundary bursts while keeping network cost to **1 RTT** and memory to bytes.

#### Q12: Why does EdgeFlow rate limiting "fail open" if Redis goes down?
**A:** If Redis crashes or experiences network partitioning, failing closed would cause the gateway to return HTTP 500/429 for all traffic, taking down healthy backend services. By failing open, the gateway logs an urgent error and allows requests through. Downstream services remain protected by the circuit breaker and health scheduler. High availability takes precedence over strict rate enforcement during infrastructure degradation.

#### Q13: How does the health scheduler detect and remove unhealthy backends?
**A:** A background worker polls each upstream target's `health_check_path` (e.g. `/health`) every 30 seconds with a 5-second timeout. To avoid flapping due to transient network blips, an upstream is only marked unhealthy after 3 consecutive failed health checks. Once unhealthy, the load balancer filters it out from candidate targets. When 2 consecutive checks succeed, it is restored.

#### Q14: How are cache stampedes (thundering herds) prevented on high-traffic routes?
**A:** When a cached response expires on a route handling 5,000 req/s, thousands of concurrent requests could miss cache simultaneously and overwhelm the backend service. EdgeFlow mitigates this by allowing routes to configure cache TTLs and serving stale cached responses if the upstream circuit opens. For future enhancement, an in-memory single-flight promise map (mutex lock per cache key) can deduplicate concurrent fetches so only 1 request queries the backend while the remaining 4,999 await that promise.

---

### Category 3: Authentication, Security & Cryptography

#### Q15: How are API keys formatted, stored, and validated? Why SHA-256 instead of bcrypt?
**A:** EdgeFlow API keys follow Stripe's format: `ef_live_<12-byte-keyId>.<32-byte-secret>`.
- The public `keyId` enables $O(\log n)$ indexed database lookups.
- The secret contains 32 bytes of cryptographically secure random entropy (256 bits).
- We store only `SHA-256(secret)` in PostgreSQL — never plaintext.
- **Why SHA-256 over bcrypt?** Bcrypt is designed for low-entropy human passwords, adding ~250ms of CPU-intensive hashing. For high-entropy 256-bit machine secrets, brute-force attacks are mathematically infeasible. SHA-256 computes in microseconds. Validated keys are cached in Redis for 5 minutes (`ef:apikey:<keyId>`), achieving sub-millisecond authentication.

#### Q16: How does multi-device refresh token rotation work? How does it prevent replay attacks?
**A:** Dashboard administrators receive a short-lived 15-minute HS256 JWT access token and a 7-day refresh token stored in an `httpOnly` secure cookie. Each refresh token contains a unique `jti` (JWT ID). EdgeFlow tracks active session JTIs (supporting up to 5 concurrent active devices in a PostgreSQL JSONB column).
When refreshing:
1. The presented `jti` must exist in active device sessions.
2. The old `jti` is removed and replaced with a new `jti` (rotation).
3. **Replay Detection:** If an attacker steals a previously used refresh token and attempts to refresh, its `jti` is no longer active. EdgeFlow detects the token replay, returns HTTP 401, and immediately revokes all active sessions for that user (RFC 6749 §10.4).

#### Q17: Why use bcrypt cost factor 12 for admin passwords?
**A:** Bcrypt includes a cryptographic salt automatically and implements a configurable work factor. At cost factor 12, hashing requires ~250ms on modern server hardware, making offline dictionary and rainbow-table attacks computationally impractical while remaining imperceptible to interactive admin login requests. EdgeFlow also implements a `needsRehash()` check on login to automatically upgrade legacy hashes if security cost configs increase.

#### Q18: What is the difference between an access token and an API key in EdgeFlow?
**A:**
- **Access Tokens (JWT):** Short-lived (15 min), stateless, issued to human dashboard users. They carry user identity and permissions in their payload and are verified cryptographically using the shared secret without database lookups.
- **API Keys:** Long-lived, opaque credentials issued to automated microservice consumers. They are passed via `X-API-Key` headers, verified against Redis/Postgres hashes, and tracked with usage metrics (`total_requests`, `last_used_at`).

#### Q19: How does EdgeFlow mitigate Cross-Site Scripting (XSS) and Cross-Site Request Forgery (CSRF)?
**A:**
- Refresh tokens are stored strictly in `httpOnly`, `SameSite=Strict`, `Secure` cookies, preventing JavaScript access and cross-site exfiltration.
- Access tokens are stored in application memory / local state.
- CORS origins are restricted to configured white-lists via the `cors` middleware.
- Standard security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`) are injected across all responses.

#### Q20: How do you prevent timing attacks during secret comparison?
**A:** When comparing cryptographic hashes or secrets, standard string comparisons (`===`) terminate early on the first non-matching byte, leaking timing information that allows attackers to reconstruct secrets byte by byte. EdgeFlow employs `crypto.timingSafeEqual()` with fixed-length Buffer representations to guarantee constant-time execution.

#### Q21: How are API key usage metrics tracked without creating database lock contention?
**A:** Updating `total_requests` and `last_used_at` directly in PostgreSQL on every request would serialize transactions and cause row-lock contention on high-throughput keys. EdgeFlow uses an in-memory micro-accumulator (`usageAccumulator` in `apiKeysService.js`). Requests increment an in-memory counter; every 5 seconds, the accumulated increments are flushed via batched SQL `UPDATE`s, eliminating database write pressure.

---

### Category 4: High-Throughput I/O & Database Optimization

#### Q22: Why does EdgeFlow use PostgreSQL instead of MongoDB?
**A:** API gateway configuration is inherently relational: services have many upstream targets; services have many routes; routes have many API keys and request logs. PostgreSQL provides:
- Foreign key constraints with cascading deletes.
- ACID transactions ensuring atomic service and route configuration updates.
- Native `PERCENTILE_CONT(0.95)` functions for calculating p95 latency percentiles.
- `JSONB` support for semi-structured fields (such as upstream target arrays and pipeline stage timings).
Emulating relational integrity in MongoDB would require fragile application-level multi-document transactions.

#### Q23: How does the asynchronous log batcher (`logBatcher`) achieve a 98% reduction in DB queries?
**A:** Under a load of 10,000 req/s, executing individual SQL `INSERT` statements would overwhelm the PostgreSQL connection pool (max 20 connections) and exhaust thread capacity.
EdgeFlow's `logBatcher`:
1. Enqueues log objects into an in-memory array on request completion.
2. Flushes when the batch reaches 50 items or when a 1000ms timer fires.
3. Formats all 50 items into a single multi-row parameterized `INSERT INTO request_logs (...) VALUES (...), (...), ...`.
4. Flushes 50 records in 1 database round-trip instead of 50 separate queries, reducing pool pressure by 98%.

#### Q24: How does `logBatcher` protect the Node.js process from out-of-memory (OOM) errors during backpressure?
**A:** If PostgreSQL slows down or connection pools block under extreme load, an unbounded in-memory array would accumulate hundreds of thousands of objects, exhausting the 2 GB V8 heap limit. EdgeFlow implements bounded backpressure (`MAX_QUEUE_SIZE = 2000`). If the queue exceeds capacity, the oldest 25% of logs are evicted to safeguard the gateway process:
```javascript
if (queue.length >= MAX_QUEUE_SIZE) {
  queue.splice(0, Math.floor(MAX_QUEUE_SIZE / 4));
}
```

#### Q25: How does `analyticsService` compute real-time rollups without overloading the database?
**A:** Rather than running expensive aggregation queries (`GROUP BY date_trunc('minute', created_at)`) over millions of raw `request_logs` rows, `analyticsService` accumulates per-minute service metrics in an in-memory map keyed by `${minute}:${serviceId}`. Every 1000ms, the aggregated entries are flushed using PostgreSQL `INSERT ... ON CONFLICT (service_id, bucket_minute) DO UPDATE`. Dashboard queries read from this pre-aggregated `analytics_rollups` table in sub-millisecond time.

#### Q26: How does EdgeFlow manage connection pools in PostgreSQL and Redis?
**A:**
- **PostgreSQL:** Uses `pg.Pool` configured with max 20 connections, 30s idle timeout, and 2s connection timeout. Queries are executed via `pool.query()`, which automatically checks out and releases connections back to the pool.
- **Redis:** Uses `redis` client with auto-reconnection and exponential backoff. Operations are executed through pipelining (`client.multi()`) to combine multiple commands into single network packets.

---

### Category 5: Production Operations, Testing & Debugging

#### Q27: What is the difference between `/health` and `/api/v1/monitoring/ready`?
**A:**
- `/health` is a lightweight **liveness probe** that returns HTTP 200 `{ status: 'ok' }` as long as the Node.js HTTP server is running. Orchestrators (Docker, Kubernetes) use it to restart crashed containers.
- `/api/v1/monitoring/ready` is a deep **readiness probe** that verifies database connectivity (`SELECT 1`), Redis ping response, service cache status, and circuit breaker health. Load balancers use it to decide whether the instance is ready to receive client traffic.

#### Q28: How does EdgeFlow handle graceful shutdown on SIGTERM / SIGINT?
**A:** In `server.js`:
1. Stops accepting new HTTP connections via `server.close()`.
2. Flushes any remaining batched logs (`logBatcher.flush()`).
3. Flushes in-memory analytics rollups (`analyticsService.flush()`).
4. Flushes batched API key usage metrics (`apiKeysService.flushUsage()`).
5. Closes Redis subscriber and client connections (`circuitBreaker.close()`, `redis.close()`).
6. Drains and closes the PostgreSQL connection pool (`pool.close()`).
7. Exits with code 0. If cleanup hangs, a 10-second forced termination timer triggers.

#### Q29: What is EdgeFlow's automated testing strategy?
**A:** EdgeFlow employs a 3-tier testing hierarchy:
1. **Unit & Service Tests (Jest):** 8 test suites containing 28 automated tests covering route caching, load balancing math, circuit breaker state transitions, rate limiter formulas, log batching backpressure, and path rewriting.
2. **Diagnostic Integration Testing:** A 33-assertion test script (`node backend/test-routing-fix.js`) verifying route normalization, schema validation, prefix stripping, and end-to-end proxy dispatch.
3. **High-Concurrency Benchmarking (Autocannon):** Automated 100-VU performance suite testing Cache MISS, Cache HIT, and 20s soak endurance under real network load.

#### Q30: What was the most complex technical challenge encountered in this project, and how did you resolve it?
**A:** The most subtle bug occurred in request retry handling and stream consumption. Initially, when an upstream target failed connection establishment, the retry logic attempted to re-dispatch `proxy.web(req, res)`. However, because the incoming HTTP body stream had already been partially or fully consumed by the first attempt, the retried request hung or sent a truncated payload.
Additionally, when upstream errors occurred, `http-proxy` had already hijacked the Express response headers, making standard error formatting throw `ERR_HTTP_HEADERS_SENT`.
**Resolution:**
1. Implemented incoming request body pre-buffering (`readRequestBody`) into an in-memory Buffer for non-GET requests, allowing a fresh `Readable` stream to be re-instantiated on retry.
2. Verified `res.headersSent` guards before attempting upstream failover or returning error responses.
3. Integrated `loadBalancer.nextTarget` on retry to guarantee the secondary attempt routed to an alternate healthy node.

---

## 📄 License

MIT © 2025 [Pankaj Jangid](https://github.com/Hunterx15). Designed for high-scale backend engineering interviews.
