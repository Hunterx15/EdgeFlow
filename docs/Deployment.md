# Deployment

## Render (Backend)

1. Create a new Web Service on Render
2. Connect the repository
3. Set root directory to `backend`
4. Build command: `npm install`
5. Start command: `node src/server.js`
6. Add environment variables (see Configuration below)
7. Health check URL: `/health`

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | No | Defaults to 4000 |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Access token signing secret (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret (min 32 chars) |
| `SEED_ADMIN_EMAIL` | No | Initial admin email (default: admin@edgeflow.dev) |
| `SEED_ADMIN_PASSWORD` | Yes | Initial admin password (must not be default in production) |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `TRUST_PROXY` | No | Proxy hop count (default: 1) |

### Render Blueprint

The repository includes a `render.yaml` that automates the setup:

```yaml
# render.yaml configures:
# - Web service (Node.js)
# - PostgreSQL database
# - Redis instance
# - Auto-generated JWT secrets
```

Generate secrets locally before deploying:
```bash
openssl rand -hex 64  # JWT_SECRET
openssl rand -hex 64  # JWT_REFRESH_SECRET
```

## Vercel (Frontend)

1. Import the repository on Vercel
2. Set root directory to `frontend`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Environment variables:
   - `VITE_API_URL` — Backend URL (e.g., `https://edgeflow-backend.onrender.com`)
   - `VITE_API_BASE_URL` — API prefix (default: `/api/v1`)

## Docker

```bash
# Start the entire stack
docker compose up --build

# Services:
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
# - Backend: localhost:4000
# - Frontend: localhost:8080
# - Demo service: localhost:3001
```

Docker Compose requires these environment variables to be set before starting:
```bash
export JWT_SECRET=$(openssl rand -hex 64)
export JWT_REFRESH_SECRET=$(openssl rand -hex 64)
export SEED_ADMIN_PASSWORD="YourSecurePassword123"
docker compose up --build
```

## Health Checks

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | None | Liveness — is the process running? |
| `GET /api/v1/monitoring/live` | None | Liveness — uptime + timestamp |
| `GET /api/v1/monitoring/ready` | None | Readiness — full subsystem status (DB, Redis, services, circuit breakers) |

Use `/health` for container orchestrator liveness probes and `/api/v1/monitoring/ready` for readiness probes.

## Graceful Shutdown

On `SIGINT` or `SIGTERM`:
1. Stop accepting new connections (`server.close()`)
2. Wait for in-flight requests to complete
3. Stop health check scheduler
4. Close PostgreSQL pool
5. Close Redis connection
6. Exit

## Migrations

Database migrations run automatically on boot (`await migrate()` in `server.js`). The `schema_migrations` table tracks applied migrations. Each migration runs in a transaction.

Current migrations:
- `0001_initial_schema` — Creates all tables, indexes, and triggers
- `0002_strip_gateway_prefix_from_routes` — Fixes routes stored with `/gateway` prefix
- `0003_add_analytics_indexes` — Performance indexes for analytics queries
