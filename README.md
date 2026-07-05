# 🌊 EdgeFlow

> A modern, lightweight **API Gateway** built from scratch with Node.js, Express, PostgreSQL, Redis, and React 19.
> Designed to be confidently explained for 20–30 minutes during an SDE interview.

EdgeFlow sits in front of multiple backend services and centralizes the cross-cutting concerns every production system eventually needs: **routing, authentication, rate limiting, caching, analytics, circuit breaking, and monitoring** — all behind a clean modern admin dashboard with a built-in API playground and request pipeline visualizer.

---

## 📑 Table of Contents

1. [Why an API Gateway?](#-why-an-api-gateway)
2. [Folder Structure](#-folder-structure)
3. [Architecture](#-architecture)
4. [Reverse Proxy](#-reverse-proxy)
5. [Redis](#-redis)
6. [JWT Authentication](#-jwt-authentication)
7. [Load Balancer](#-load-balancer)
8. [Circuit Breaker](#-circuit-breaker)
9. [Rate Limiting](#-rate-limiting)
10. [Docker](#-docker)
11. [Special Features](#-special-features)
12. [Tech Stack](#-tech-stack)
13. [Quick Start](#-quick-start)
14. [API Reference](#-api-reference)
15. [Future Improvements](#-future-improvements)
16. [License](#-license)

---

## 🧠 Why an API Gateway?

Without a gateway, every backend service has to reimplement the same concerns: auth, rate limiting, logging, metrics, CORS, TLS termination. With 5+ services this becomes unsustainable — duplication, drift, security holes.

A gateway centralizes these concerns in **one place** so backend services can focus on business logic. Clients (browsers, mobile apps, partner systems) talk to a single stable entry point, and the gateway team can evolve backend topology — split a monolith into microservices, add replicas, change a URL — without breaking clients.

EdgeFlow implements the **minimal** set of concerns a real-world gateway needs:

| Concern | Implementation |
| --- | --- |
| Reverse proxy | `http-proxy` with retry-once + circuit breaker |
| Dynamic routing | Routes table in PostgreSQL, in-memory cache |
| Load balancing | Smooth weighted round-robin |
| Auth | JWT (dashboard admins) + opaque API keys (consumers) |
| Rate limiting | Sliding-window counter in Redis |
| Response cache | Redis, per-route TTL |
| Circuit breaker | CLOSED / OPEN / HALF_OPEN state machine |
| Analytics | Per-minute rollups in PostgreSQL + pipeline_stages JSONB |
| Health checks | Per-service scheduler with grace periods |
| Observability | Structured logger + Swagger + monitoring endpoint + pipeline visualizer |

This is **not** Kong, **not** Express Gateway — it is an original product, written from scratch using Express Gateway only as architectural inspiration.

---

## 📁 Folder Structure

```
edgeflow/
├── README.md                       ← you are here
├── INTERVIEW.md                    ← 30 interview Q&A
├── docker-compose.yml              ← full-stack orchestration
├── .env.example                    ← root-level env template
├── .dockerignore
│
├── backend/                        ← Node.js + Express gateway
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── server.js               ← entry point (boots DB, Redis, scheduler)
│       ├── app.js                  ← Express app factory
│       ├── config/                 ← centralized env-driven config
│       ├── database/               ← pg Pool, Redis client, migrations
│       ├── services/               ← business logic + DB access (NO repositories)
│       ├── middlewares/            ← auth, validate, errorHandler, logger
│       ├── controllers/            ← HTTP req/res orchestration
│       ├── routes/                 ← Express routers
│       ├── gateway/                ← proxyEngine, routeCache, loadBalancer, pathRewriter
│       ├── schemas/                ← validation schemas
│       ├── utils/                  ← jwt, password, apiKey, logger, http, errors
│       └── docs/                   ← swagger spec
│
├── frontend/                       ← React 19 + Vite dashboard
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                 ← routing
│       ├── api/                    ← axios client + endpoint definitions
│       ├── context/                ← AuthContext
│       ├── components/             ← ui/, layout/, charts/
│       ├── layouts/                ← MainLayout (sidebar + topbar)
│       └── pages/                  ← 12 pages (Dashboard, Services, Routes,
│                                     API Keys, Playground, Pipeline, Timeline,
│                                     DependencyGraph, Logs, Analytics,
│                                     Monitoring, Settings)
│
├── docker/                         ← Dockerfiles + service configs
│   ├── backend/Dockerfile
│   ├── frontend/Dockerfile + nginx.conf
│   ├── postgres/init.sql
│   ├── redis/redis.conf
│   └── demo-service/               ← mock backend for immediate testing
│
└── docs/
    └── diagrams/                   ← architecture, ER, request-flow,
                                      auth-flow, redis-flow, deployment-guide
```

---

## 🏗 Architecture

EdgeFlow intentionally uses a **simpler architecture** than traditional gateways — no repository pattern:

```
Routes          → Express routers (HTTP endpoint definitions)
Middlewares     → auth, validation, logging, rate limit, cache, error wrap
Controllers     → HTTP req/res orchestration (no business logic)
Services        → business logic + DB access (uses pg Pool directly)
Database        → PostgreSQL + Redis
```

**Why no repository layer?** For a single-process gateway with a limited number of entity types, the repository pattern adds indirection without adding testability or flexibility. Services use parameterized queries directly via the shared pg Pool. This is easier to reason about, has fewer files, and is simpler to explain in interviews.

See [`docs/diagrams/architecture.md`](docs/diagrams/architecture.md) for the full diagram.

---

## 🔄 Reverse Proxy

The proxy engine (`backend/src/gateway/proxyEngine.js`) is mounted at `/gateway/*` and uses `http-proxy` to forward requests. The engine runs **10 stages** per request, and each stage's duration is recorded in `request_logs.pipeline_stages` so the dashboard's Pipeline Visualizer page can render real timings:

1. **Route Lookup** — in-memory cache (`routeCache.match()`)
2. **Service Load** — fetch the service + its upstream targets from PG
3. **API Key Auth** — if `api_key_required`, validate `X-API-Key`
4. **Rate Limit** — sliding-window counter in Redis
5. **Cache Lookup** — GET-only, per-route TTL
6. **Load Balancer** — smooth weighted round-robin
7. **Circuit Breaker** — skip open circuits
8. **Path Rewrite** — `strip_prefix` + `upstream_path` template
9. **Reverse Proxy** — `http-proxy.web()` with **retry-once** on failure
10. **Response + Log** — fire-and-forget write to Postgres

Forwarding headers set on every proxied request:
- `X-EdgeFlow-Request-Id`
- `X-EdgeFlow-Service-Id`
- `X-EdgeFlow-Route-Id`
- `X-EdgeFlow-Upstream`
- `X-Forwarded-Host` / `X-Forwarded-Proto`

See [`docs/diagrams/request-flow.md`](docs/diagrams/request-flow.md) for the full flow.

---

## ⚡ Redis

Redis is used for three things:

1. **Response cache** — `cache:r:<routeId>:<method>:<url>` → JSON `{ status, headers, body }`, TTL per route.
2. **Rate-limit counters** — `rl:<identity>:<routeId>:60:<bucket>` and `rl:<identity>:<routeId>:3600:<bucket>`, INCR + EXPIRE.
3. **Circuit-breaker state** — mirrored to PostgreSQL (in-memory Map for hot reads).

**What happens when Redis is down?** The `redis.getClient()` falls back to an in-memory `Map`-based shim so the gateway keeps serving traffic. This is logged loudly. In a single-instance deployment the gateway keeps working; in a multi-instance deployment cache hit rate drops to ~0% and rate-limit counters diverge between instances.

See [`docs/diagrams/redis-flow.md`](docs/diagrams/redis-flow.md) for the full flow.

---

## 🔐 JWT Authentication

EdgeFlow has **two distinct auth surfaces**:

### Dashboard admins → JWT

- **Access token** (15 min, HS256, stateless) — sent as `Authorization: Bearer <token>`.
- **Refresh token** (7 days, also JWT, tracked by `jti` claim) — sent as an httpOnly cookie.
- On every refresh, we issue a new refresh token AND invalidate the previous one by updating `users.refresh_token_jti`. This detects token theft: if a stolen refresh token is replayed after the legitimate user has refreshed, the jti won't match → 401 + revoke all sessions.

### API consumers → opaque API keys

- Format: `ef_live_<12-byte-keyId>.<32-byte-secret>`.
- The `keyId` (before the `.`) is safe to log; the `secret` is never stored — only its SHA-256 hash.
- Verification: split on `.`, hash the secret, look up by `(key_id, key_hash)`. O(log n) via the unique index on `key_id`.
- This mirrors how Stripe / GitHub personal access tokens work.

Passwords are hashed with **bcrypt at cost factor 12**. On login, if the stored hash has a lower cost factor than the current config, we transparently re-hash on the fly.

See [`docs/diagrams/auth-flow.md`](docs/diagrams/auth-flow.md) for the full flow.

---

## ⚖️ Load Balancer

**Smooth weighted round-robin** (the same algorithm nginx uses). Each target has a `weight` (configured) and a `currentWeight` (mutable):

```
on each call:
  for each target t:  t.currentWeight += t.weight
  pick the target with the highest currentWeight
  subtract the total weight from the picked target's currentWeight
```

This produces a smooth distribution (e.g. weights 5:1 → every 6th request goes to the second target, never a burst of 5 in a row). Unhealthy targets are filtered out by the health scheduler before selection.

---

## 🛡 Circuit Breaker

Per-upstream-URL state machine with three states:

```
       failure_count >= threshold              elapsed > openStateMs
       ┌──────────────────────────┐           ┌────────────────────────┐
       ▼                          │           ▼                        │
   ┌───────┐  failure  ┌────────┐  │   ┌──────────┐  success*threshold ┌───────┐
   │CLOSED │ ────────▶ │ OPEN   │      │ HALF_OPEN│ ─────────────────▶ │CLOSED │
   │       │           │ (wait) │      │ (probe)  │                    │       │
   └───────┘           └────────┘      └──────────┘  failure           └───────┘
       ▲                                  │       ┌─────────────────────┘
       │                                  └──────▶ back to OPEN
       └─ success resets failure_count
```

- **CLOSED** → traffic flows; failures increment a counter. At `failureThreshold` (5) → OPEN.
- **OPEN** → fail fast with 503. After `openStateMs` (30s) → HALF_OPEN.
- **HALF_OPEN** → allow up to `halfOpenMaxCalls` (3) probe requests. `successThreshold` (2) successes → CLOSED; any failure → OPEN again.

State is kept in memory for hot-path reads AND mirrored to PostgreSQL so it survives restarts and is shared across replicas.

---

## 🚦 Rate Limiting

Per `(identity, route)` sliding-window approximation, implemented as two Redis counters:

```
minute bucket:  rl:<identity>:<routeId>:60:<floor(now/60)>    TTL 70s
hour bucket:    rl:<identity>:<routeId>:3600:<floor(now/3600)> TTL 3700s
```

Single Redis PIPELINE per request:
```
INCR minute_key; EXPIRE minute_key 70
INCR hour_key;   EXPIRE hour_key 3700
```

If `minute_count > limit_per_min` OR `hour_count > hour_limit` → 429 with `Retry-After: 60`.

**Why a fixed-window approximation instead of a true sliding window?** A true sliding window needs a sorted set per identity (ZADD + ZREMRANGEBYSCORE + ZCARD per request) — ~3x more Redis work. The fixed-window approximation is "good enough" for most API gateway use cases and uses only 2 INCR + 2 EXPIRE per request — single round-trip via pipelining.

**Fail-open policy:** if Redis is unreachable, we let the request through (logged loudly). The circuit breaker catches downstream issues.

---

## 🐳 Docker

The entire stack — Postgres, Redis, backend, frontend, plus a demo backend service — boots with one command:

```bash
docker compose up --build
```

| URL | What |
| --- | --- |
| http://localhost:8080 | Dashboard (React frontend via nginx) |
| http://localhost:4000 | Backend API |
| http://localhost:4000/api/v1/docs | Swagger UI |
| http://localhost:4000/health | Liveness probe |
| http://localhost:4000/gateway/* | Gateway proxy |

The `docker-compose.yml` defines health checks + `depends_on: condition: service_healthy` so the backend waits for Postgres + Redis before booting.

See [`docs/diagrams/deployment-guide.md`](docs/diagrams/deployment-guide.md) for production deployment notes.

---

## ✨ Special Features

EdgeFlow includes 5 features that go beyond a standard CRUD dashboard:

### 1. API Playground (`/playground`)

A built-in Postman-like API tester. Pick a method, enter a URL (any `/gateway/*` path), add headers / query params / body, hit Send. The request goes through the gateway so all middleware actually runs. Response panel shows status, headers, body, latency, and size.

### 2. Request Pipeline Visualizer (`/pipeline`)

Animated page that shows the 10-stage request flow:
```
Client → Route Lookup → API Key Auth → Rate Limiter → Redis Cache
→ Circuit Breaker → Load Balancer → Reverse Proxy → Microservice → Response
```

Pick any recent request from the sidebar, hit Play, and watch each stage light up with its real duration, status, and cache hit/miss.

### 3. Gateway Timeline (`/timeline`)

Live vertical timeline of recent requests with their full pipeline chain. Each entry shows the chain:
```
12:10:32 → Incoming → Route Matched → Rate Limited → Cache Miss
         → Service Selected → Forwarded → Response → 200 OK → 41ms
```

Auto-refreshes every 10s.

### 4. Service Dependency Graph (`/dependency-graph`)

Visualizes the gateway + every registered service as a tree:
```
EdgeFlow Gateway
├── User Service          🟢 healthy
├── Payment Service       🟡 degraded (half-open circuit)
├── Inventory Service     🟢 healthy
└── Notification Service  🔴 down
```

Each service node shows its upstream targets with per-target health dots.

### 5. Live Metrics Dashboard (`/`)

The homepage shows 10 live metrics:
- Gateway Uptime
- Active Requests
- Requests/sec
- P95 Latency
- Error Rate
- Cache Hit Ratio
- Circuit Breaker State
- Redis Memory Usage
- PostgreSQL Connections
- Total Services

Updates every 5 seconds.

---

## 🛠 Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS, React Router, Axios, Recharts, React Hook Form |
| Backend | Node.js 18+, Express 4 |
| Database | PostgreSQL 16 |
| Cache / counters | Redis 7 |
| Auth | JWT (HS256, access + refresh), bcrypt, opaque API keys (SHA-256) |
| Reverse proxy | `http-proxy` |
| Containerization | Docker, docker-compose |
| API docs | Swagger / OpenAPI 3 |

---

## 🚀 Quick Start

```bash
git clone <this-repo>
cd edgeflow
docker compose up --build
```

Wait ~30 seconds, then open http://localhost:8080.

**Sign in** with `admin@edgeflow.dev` / `Admin@12345`.

**Test the proxy:**
1. Register a service via the dashboard (Services → New Service).
2. Register a route (Routes → New Route).
3. Use the API Playground page to send a test request and watch the Pipeline Visualizer light up.

---

## 📚 API Reference

Interactive Swagger UI at **`/api/v1/docs`** once the backend is running.

Quick reference:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Rotate access token |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Current user profile |
| GET | `/api/v1/dashboard/overview` | Dashboard overview |
| GET | `/api/v1/dashboard/live-metrics` | Live metrics (RPS, P95, active) |
| GET | `/api/v1/services` | List services |
| POST | `/api/v1/services` | Register service |
| GET | `/api/v1/routes` | List routes |
| POST | `/api/v1/routes` | Register route |
| GET | `/api/v1/api-keys` | List API keys |
| POST | `/api/v1/api-keys` | Issue API key (plaintext shown once) |
| GET | `/api/v1/logs` | Paginated request logs |
| GET | `/api/v1/logs/timeline` | Recent logs with pipeline stages |
| GET | `/api/v1/logs/:id/pipeline` | Pipeline stages for a specific log |
| GET | `/api/v1/analytics/per-minute` | Per-minute rollups |
| GET | `/api/v1/monitoring/ready` | Full system readiness probe |
| GET | `/api/v1/monitoring/dependency-graph` | Service dependency graph data |
| GET | `/api/v1/monitoring/circuit-breakers` | Circuit breaker states |
| POST | `/api/v1/monitoring/cache/flush` | Flush response cache |
| POST | `/api/v1/playground/send` | Send a test request through the gateway |
| ALL | `/gateway/*` | The proxy itself |

---

## 🚧 Future Improvements

- **WebSocket proxying** — `http-proxy` supports it; needs a separate upgrade handler.
- **gRPC support** — currently HTTP-only.
- **JWT blacklist** — for instant access-token revocation on logout / password change.
- **Audit log** — separate from `request_logs`, records admin actions.
- **Prometheus metrics** — `/metrics` endpoint with `http_requests_total`, `http_request_duration_seconds`, etc.
- **OTLP tracing** — OpenTelemetry spans propagated to upstreams via `traceparent`.
- **Multi-tenancy** — add `organization_id` to every table for SaaS use.
- **Columnar log storage** — ship `request_logs` to ClickHouse after 24h.
- **Per-instance rate-limit bypass** — let admin temporarily raise a key's limit without a DB write.

---

## 📄 License

MIT © 2025 EdgeFlow. Built for SDE interview preparation.
