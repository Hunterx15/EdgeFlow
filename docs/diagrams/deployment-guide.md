# EdgeFlow - Deployment Guide

## Quick Start (Docker Compose) — recommended

The entire stack boots with one command:

```bash
git clone <this-repo>
cd edgeflow
docker compose up --build
```

Wait ~30 seconds for health checks to pass, then:

| URL | What |
| --- | --- |
| http://localhost:8080 | Dashboard (React frontend via nginx) |
| http://localhost:4000 | Backend API |
| http://localhost:4000/api/v1/docs | Swagger UI |
| http://localhost:4000/health | Liveness probe |
| http://localhost:4000/gateway/* | Gateway proxy |
| http://localhost:5432 | PostgreSQL (edgeflow / edgeflow) |
| http://localhost:6379 | Redis |

**Sign in** with `admin@edgeflow.dev` / `Admin@12345`.

## Test the proxy immediately

The docker-compose includes a `demo-service` (tiny Express echo server)
so you can test the gateway without writing your own backend.

1. Register a service via the dashboard (Services → New Service):
   - Name: `Demo Service`
   - Base Path: `/demo`
   - Upstream Targets: `http://demo-service:3001`
   - Health Check Path: `/health`

2. Register a route (Routes → New Route):
   - Service: Demo Service
   - Method: GET
   - Public Path: `/gateway/demo/*`
   - Upstream Path: `/`
   - Auth Required: false
   - API Key Required: false

3. Hit the gateway:
   ```bash
   curl http://localhost:4000/gateway/demo/hello
   → {
       "service":"edgeflow-demo",
       "method":"GET",
       "path":"/hello",
       "headers": {
         "x-edgeflow-request-id":"req_...",
         "x-edgeflow-service-id":"...",
         "x-edgeflow-route-id":"...",
         "x-edgeflow-upstream":"http://demo-service:3001"
       }
     }
   ```

4. Watch the request appear in:
   - Dashboard (live metrics update)
   - Logs page
   - Gateway Timeline page
   - Pipeline Visualizer page (select the request and click Play)

## Local Development (without Docker)

```bash
# 1. Start Postgres + Redis
brew install postgresql redis
brew services start postgresql
brew services start redis
createdb edgeflow

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run dev          # boots on :4000, runs migrations on startup

# 3. Frontend
cd ../frontend
cp .env.example .env
npm install
npm run dev          # boots on :5173, proxies /api + /gateway to :4000
```

## Production Deployment

### Environment Variables (must override defaults)

| Variable | Why it matters |
| --- | --- |
| `JWT_SECRET` | Must be a long random string. Used to sign access tokens. |
| `JWT_REFRESH_SECRET` | Must be DIFFERENT from JWT_SECRET. Used to sign refresh tokens. |
| `DATABASE_URL` | Production Postgres connection string. |
| `REDIS_URL` | Production Redis connection string. |
| `REDIS_ENABLED=true` | Set to `false` only for testing. |
| `CORS_ORIGINS` | Comma-separated list of allowed dashboard origins. |
| `SEED_ADMIN_PASSWORD` | Override the default `Admin@12345`. |
| `NODE_ENV=production` | Enables JSON logs, hides error stacks from clients. |

### Horizontal Scaling

EdgeFlow is stateless (per-instance) for HTTP traffic. The only per-instance
state is the in-memory route cache (refreshed every 60s) and the in-memory
circuit-breaker state (mirrored to PostgreSQL).

To scale horizontally:
- Run N replicas behind a TCP load balancer (AWS ALB, nginx, HAProxy).
- All replicas share the same PostgreSQL + Redis.
- Rate-limit counters and cache are shared via Redis (no divergence).
- Circuit-breaker state is shared via PostgreSQL (eventually consistent).
- Health checks run on every replica (a bit wasteful but harmless).

### Health Checks for Load Balancers

```
GET /health              → 200 { status: 'ok' }   (liveness, always 200 if process is up)
GET /api/v1/monitoring/ready → 200 or 503          (readiness, 503 if any subsystem is down)
```

Configure your load balancer to:
- Use `/health` for liveness (don't kill the pod if it returns 200).
- Use `/api/v1/monitoring/ready` for readiness (don't route traffic to a pod that returns 503).

### Database Backup

The `request_logs` table grows unbounded. In production, set up a daily
cron job to:
1. Export rows older than 30 days to cold storage (S3, BigQuery).
2. Delete the exported rows from `request_logs`.
3. Run `VACUUM ANALYZE request_logs` to reclaim space.

The `analytics` table is much smaller (per-minute rollups) and can be
kept indefinitely, or cleaned up after 90 days via `analyticsService.cleanup()`.

### TLS Termination

In production, terminate TLS at the load balancer (AWS ALB, Cloudflare,
nginx). EdgeFlow itself listens on plain HTTP. The `X-Forwarded-Proto`
header is respected by Express so `req.secure` and `req.protocol` work
correctly for cookie `secure` flag decisions.

### Monitoring EdgeFlow Itself

Point Prometheus at the `/api/v1/monitoring/ready` endpoint (it returns
JSON, not Prometheus format, but you can use a JSON exporter). Key
metrics to alert on:

- `status != 'ok'` → page someone
- `subsystems.redis.fallback === true` → Redis is down
- `subsystems.circuitBreakers.openCount > 0` → a backend is failing
- `subsystems.services.unhealthy > 0` → a service is down
- `subsystems.live.p95LatencyMs > 1000` → latency is degrading
