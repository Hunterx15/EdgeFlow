# EdgeFlow

A high-performance API Gateway built on Node.js, Express, PostgreSQL, and Redis.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)

## Features

- **Reverse Proxy** — Dynamic routing to multiple backend services with path rewriting and wildcard matching
- **Authentication** — JWT access/refresh tokens with rotation, replay detection, and algorithm pinning
- **API Keys** — Per-key rate limits, scopes, expiration, and usage tracking
- **Rate Limiting** — Redis-backed fixed-window rate limiter with per-identity and per-route configuration
- **Response Caching** — Redis response cache with per-route TTL and automatic invalidation
- **Circuit Breaker** — Per-upstream state machine (CLOSED → OPEN → HALF_OPEN) with PostgreSQL persistence
- **Load Balancing** — Smooth weighted round-robin (nginx algorithm) with health-aware target selection
- **Health Checks** — Automatic upstream probing with configurable intervals and failure thresholds
- **Analytics** — P50/P95/P99 latency, top routes, slow endpoints, traffic heatmap, method/status/service distribution
- **Monitoring** — Real-time Redis, PostgreSQL, and Node.js runtime metrics (heap, CPU, event loop lag)
- **Request Logs** — Per-request pipeline stages with full timing data
- **API Playground** — Built-in Postman-like tester with per-session cookie jar, history, and cURL export
- **Pipeline Visualizer** — Clickable per-stage latency and metadata for every proxied request
- **Swagger UI** — Interactive API documentation at `/api/v1/docs`

## Architecture

```
Client
  │
  ▼
Express Gateway
  ├── Helmet (security headers)
  ├── CORS (origin whitelist)
  ├── Compression
  ├── Request ID + Response Logger
  │
  ├── /api/v1/*  →  Management API (Routes → Controllers → Services → DB)
  │
  └── /gateway/* →  Proxy Pipeline:
        1. Route Lookup (in-memory cache)
        2. Service Load (PostgreSQL)
        3. API Key Auth (if required)
        4. JWT Auth (if auth_required)
        5. Rate Limit (Redis)
        6. Cache Lookup (Redis, GET only)
        7. Load Balancer (weighted round-robin)
        8. Circuit Breaker (per-upstream state machine)
        9. Path Rewrite (strip prefix)
       10. Reverse Proxy (http-proxy → upstream)
       11. Record Log (PostgreSQL, fire-and-forget)
```

No circular dependencies. Services communicate via an in-process event bus. The health scheduler uses dependency injection. Verified with `madge --circular`.

See [docs/Architecture.md](docs/Architecture.md) for the full architecture document and [docs/GatewayFlow.md](docs/GatewayFlow.md) for the complete request lifecycle.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ |
| Framework | Express 4 |
| Database | PostgreSQL 16 |
| Cache / Rate Limiting | Redis 7 |
| Proxy | http-proxy |
| Auth | jsonwebtoken + bcrypt |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Container | Docker (multi-stage, non-root) |

## Quick Start

### Docker (recommended)

```bash
# Set required secrets
export JWT_SECRET=$(openssl rand -hex 64)
export JWT_REFRESH_SECRET=$(openssl rand -hex 64)
export SEED_ADMIN_PASSWORD="YourSecurePassword123"

# Start the entire stack
docker compose up --build
```

| Service | URL |
|---------|-----|
| Backend API | http://localhost:4000 |
| Dashboard | http://localhost:8080 |
| Swagger UI | http://localhost:4000/api/v1/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Manual

```bash
# Backend
cd backend
cp .env.example .env   # edit with your values
npm install
npm start

# Frontend
cd frontend
cp .env.example .env   # edit with your values
npm install
npm run dev
```

## Configuration

All configuration is via environment variables. See [`.env.example`](backend/.env.example) for the full list.

### Required for Production

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Access token signing secret (min 32 chars) |
| `JWT_REFRESH_SECRET` | Refresh token signing secret (min 32 chars) |
| `SEED_ADMIN_PASSWORD` | Initial admin password (must not be default in production) |

The gateway refuses to boot in production if any of these are missing or match insecure defaults.

## API Overview

### Management API (`/api/v1`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | — | Login with email/password |
| POST | `/auth/refresh` | Cookie | Refresh access token |
| POST | `/auth/logout` | Bearer | Logout (revoke refresh token) |
| GET | `/auth/me` | Bearer | Get current user |
| GET/POST | `/services` | Bearer | List/create services |
| GET/PUT/DELETE | `/services/:id` | Bearer | Manage a service |
| GET/POST | `/routes` | Bearer | List/create routes |
| GET/PUT/DELETE | `/routes/:id` | Bearer | Manage a route |
| GET/POST | `/api-keys` | Bearer | List/issue API keys |
| GET/PUT/DELETE | `/api-keys/:id` | Bearer | Manage an API key |
| GET | `/logs` | Bearer | Request logs with filters |
| GET | `/analytics/*` | Bearer | Analytics endpoints |
| GET | `/monitoring/live` | — | Liveness probe |
| GET | `/monitoring/ready` | — | Readiness probe |
| POST | `/playground/send` | Bearer | Send a test request through the gateway |

### Gateway Proxy (`/gateway`)

All requests to `/gateway/<publicPath>` are matched against the routes table and proxied to the configured upstream service.

```bash
# Proxy to XCode backend
curl http://localhost:4000/gateway/xcode/health

# Authenticate through the gateway
curl -X POST http://localhost:4000/gateway/xcode/user/login \
  -H "Content-Type: application/json" \
  -d '{"emailId":"test@test.com","password":"Password@123"}'
```

### API Examples

```bash
# Login to the management API
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@edgeflow.dev","password":"Admin@12345"}' \
  | jq -r '.data.accessToken')

# Create a service
curl -X POST http://localhost:4000/api/v1/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "XCode",
    "basePath": "/xcode",
    "upstreamTargets": [{"url": "https://x-code.onrender.com", "weight": 1}]
  }'

# Create a route
curl -X POST http://localhost:4000/api/v1/routes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service-id>",
    "method": "GET",
    "publicPath": "/xcode/health",
    "upstreamPath": "/health",
    "stripPrefix": true,
    "authRequired": false
  }'

# Issue an API key
curl -X POST http://localhost:4000/api/v1/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Mobile App", "rateLimitPerMin": 1000}'
```

## Monitoring

### Health Checks

| Endpoint | Purpose | Status Codes |
|----------|---------|-------------|
| `GET /health` | Container liveness | 200 if process is running |
| `GET /api/v1/monitoring/live` | Liveness with uptime | 200 |
| `GET /api/v1/monitoring/ready` | Full subsystem readiness | 200 (ok/degraded) or 503 (down) |

### Dashboard

The dashboard at `/` provides:
- **Overview** — Total requests, success rate, cache hit rate, P95 latency, live request graph
- **Monitoring** — Redis (memory, connections, uptime, ops/sec), PostgreSQL (pool, latency), Node.js (heap, RSS, event loop lag, active handles)
- **Analytics** — P50/P95/P99 latency, top routes, slow endpoints, traffic heatmap, status/method/service distribution
- **Request Logs** — Searchable, filterable request log table with pipeline details
- **Circuit Breakers** — Per-upstream state with manual reset capability
- **API Playground** — Postman-like tester with per-session cookie jar, history, cURL export

## Project Structure

```
edgeflow/
├── backend/
│   ├── src/
│   │   ├── config/          # Centralized configuration + validation
│   │   ├── controllers/     # Request handlers (9 files)
│   │   ├── database/        # PostgreSQL pool, Redis client, migrations
│   │   ├── docs/            # OpenAPI/Swagger spec
│   │   ├── gateway/         # Proxy engine, route cache, load balancer
│   │   ├── middlewares/     # Auth, validation, logging, error handling
│   │   ├── routes/          # Express route definitions (10 files)
│   │   ├── schemas/         # Input validation schemas
│   │   ├── services/        # Business logic (12 files)
│   │   └── utils/           # Shared utilities (event bus, JWT, logger, etc.)
│   └── tests/               # Test suites
├── frontend/
│   ├── src/
│   │   ├── api/             # Axios client + endpoint definitions
│   │   ├── components/      # Reusable UI components
│   │   ├── context/         # React context (auth)
│   │   ├── pages/           # Route-level page components
│   │   └── utils/           # Formatting + toast utilities
│   └── vite.config.js
├── docker/                  # Dockerfiles + configs
├── docker-compose.yml
├── docs/                    # Architecture + technical documentation
├── render.yaml              # Render deployment blueprint
└── README.md
```

## Testing

```bash
cd backend
npm install

# Run test suites
node tests/test-comprehensive.js       # Config, routing, JWT, API keys, cookies, load balancer
node tests/test-routing-fix.js         # Route lookup, cache keys, wildcard matching
node tests/test-playground-cookies.js  # Per-session cookie jar isolation
```

133 tests across 3 suites. All pass.

## Deployment

### Render (Backend)

The repository includes a `render.yaml` blueprint. See [docs/Deployment.md](docs/Deployment.md) for step-by-step instructions.

### Vercel (Frontend)

Import the repository, set root to `frontend`, set `VITE_API_URL` to the backend URL.

See [docs/Deployment.md](docs/Deployment.md) for the complete deployment guide.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/Architecture.md](docs/Architecture.md) | Layer separation, module dependencies, design decisions |
| [docs/GatewayFlow.md](docs/GatewayFlow.md) | Complete 10-stage request lifecycle |
| [docs/Security.md](docs/Security.md) | JWT, cookies, SSRF, input validation, environment validation |
| [docs/Deployment.md](docs/Deployment.md) | Render, Vercel, Docker, health checks, migrations |
| [docs/diagrams/](docs/diagrams/) | Architecture, ER diagram, Redis flow, request flow, auth flow |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `FATAL: Production config validation failed` | Set `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_PASSWORD` to non-default values |
| `ROUTE_NOT_FOUND` on gateway requests | Ensure routes are stored WITHOUT the `/gateway` prefix (run migration 0002) |
| POST body not forwarded | Ensure `express.json()` is NOT mounted on `/gateway/*` (only on `/api/v1/*`) |
| Redis connection failed | Check `REDIS_URL` and `REDIS_ENABLED=true`. Gateway falls back to in-memory mode. |
| `ECONNREFUSED` on upstream | Check that the upstream service is running and the URL is correct in the service config |

## License

MIT © 2025 EdgeFlow

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Open a Pull Request
