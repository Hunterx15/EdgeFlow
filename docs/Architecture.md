# Architecture

## Overview

EdgeFlow is a reverse-proxy API gateway built on Node.js, Express, PostgreSQL, and Redis. It sits between clients and backend services, providing routing, authentication, rate limiting, caching, circuit breaking, load balancing, and observability.

## Layer Separation

```
┌──────────────────────────────────────────────────────────────────┐
│  Client (browser, mobile, CLI)                                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│  Express Gateway                                                 │
│  ├── Helmet (security headers)                                   │
│  ├── CORS (origin whitelist)                                     │
│  ├── Cookie Parser                                               │
│  ├── Compression                                                 │
│  ├── Request ID + Response Logger                                │
│  ├── /api/v1/*  →  Express.json()  →  Management API             │
│  └── /gateway/* →  Proxy Middleware (raw stream, no body parse)  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
         ┌─────────────────┴──────────────────┐
         │                                    │
┌────────▼─────────┐               ┌──────────▼──────────┐
│  Management API  │               │  Proxy Pipeline     │
│  Routes          │               │  1. Route Lookup    │
│   ↓ Controllers  │               │  2. Service Load    │
│   ↓ Services     │               │  3. API Key Auth    │
│   ↓ Database     │               │  3.5 JWT Auth       │
│                  │               │  4. Rate Limit      │
│  PostgreSQL      │               │  5. Cache Lookup    │
│  Redis           │               │  6. Load Balancer   │
│                  │               │  7. Circuit Breaker │
│                  │               │  8. Path Rewrite    │
│                  │               │  9. Reverse Proxy   │
│                  │               │  10. Record Log     │
└──────────────────┘               └──────────┬──────────┘
                                              │
                                    ┌─────────▼─────────┐
                                    │  Upstream Service │
                                    │  (e.g. XCode)     │
                                    └───────────────────┘
```

## Module Dependencies

```
routes/ ──> controllers/ ──> services/ ──> database/
                               │
                               ├──> utils/ (event bus, JWT, logger, etc.)
                               └──> config/
                               
gateway/ ──> services/ ──> database/
           ──> utils/

services/ communicate via eventBus (no direct cross-requires for mutations)
healthScheduler uses dependency injection (no circular require on servicesService)
```

No circular dependencies. Verified with `madge --circular`.

## Key Design Decisions

### Event Bus for Cache Invalidation
Services emit events (`ROUTE_CREATED`, `SERVICE_UPDATED`) instead of directly requiring the route cache. The cache subscribes to these events. This breaks the circular dependency between `routesService ↔ routeCache` and `servicesService ↔ healthScheduler`.

### Dependency Injection for Health Scheduler
`healthScheduler` needs to load service data during health checks, but `servicesService` needs to trigger scheduling when services are created. DI breaks this cycle: `server.js` wires up provider functions at boot time.

### Body Parsing Mount Order
`express.json()` is mounted ONLY on `/api/v1/*` (management API). The `/gateway/*` route receives the raw request stream so http-proxy can forward it intact. A `proxyReq` event handler re-serializes `req.body` if a body parser consumed the stream (defense-in-depth).

### Per-Session Cookie Jar
The API Playground maintains a per-dashboard-user cookie jar (keyed by `req.user.id`). Two dashboard users never share cookies. HttpOnly cookie values are not exposed to frontend JavaScript. The jar auto-expires after 1 hour of inactivity.

### Production Config Validation
In production (`NODE_ENV=production`), the config module fails fast if JWT secrets match defaults or are too short. This prevents accidental deployment with forgeable tokens.
