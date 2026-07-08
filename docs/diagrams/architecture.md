# EdgeFlow - System Architecture

```
                                 ┌─────────────────────────────────────────────────────────────┐
                                 │                    EDGEFLOW (the gateway)                    │
                                 │                                                             │
  ┌──────────┐    HTTP/S         │  ┌──────────────────────────────────────────────────────┐   │
  │  Client  │ ─────────────────▶│  │                  Express App                          │   │
  │ (browser │                   │  │                                                      │   │
  │  / curl  │                   │  │  Middleware pipeline (linear):                        │   │
  │  / app)  │                   │  │   requestId → logger → helmet → cors → compression    │   │
  └──────────┘                   │  │                                                      │   │
       ▲                         │  │  ┌────────────────────┐    ┌────────────────────────┐ │   │
       │   HTTP response         │  │  │  Admin REST API     │    │   Gateway Proxy Engine │ │   │
       │                         │  │  │  /api/v1/*          │    │   /gateway/*           │ │   │
       │                         │  │  │  (auth, services,   │    │  (10-stage pipeline:   │ │   │
       │                         │  │  │   routes, ...)      │    │   route → service →    │ │   │
       │                         │  │  └────────┬───────────┘    │   API key → rate limit │ │   │
       │                         │  │           │                │   → cache → LB → CB    │ │   │
       │                         │  │  ┌────────▼──────────────┐ │   → proxy → response)  │ │   │
       │                         │  │  │  Services (business   │ └──────────┬─────────────┘ │   │
       │                         │  │  │  logic + DB access)   │            │               │   │
       │                         │  │  │   authService         │            │               │   │
       │                         │  │  │   servicesService     │            │               │   │
       │                         │  │  │   routesService       │            │               │   │
       │                         │  │  │   apiKeysService      │            │               │   │
       │                         │  │  │   cacheService        │            │               │   │
       │                         │  │  │   rateLimiterService  │            │               │   │
       │                         │  │  │   circuitBreaker      │            │               │   │
       │                         │  │  │   analyticsService    │            │               │   │
       │                         │  │  │   healthScheduler     │            │               │   │
       │                         │  │  │   monitoringService   │            │               │   │
       │                         │  │  └────────┬──────────────┘            │               │   │
       │                         │  │           │                           │               │   │
       │                         │  │  ┌────────▼────────┐    ┌────────────▼────────────┐  │   │
       │                         │  │  │  pg Pool        │    │  Redis                  │  │   │
       │                         │  │  │  (PostgreSQL)   │    │  (cache + rate-limit +  │  │   │
       │                         │  │  └────────┬────────┘    │   circuit-breaker state)│  │   │
       │                         │  └───────────┼─────────────┴─────────────────────────┘  │   │
       │                         └───────────────┼─────────────────────────────────────────┘   │
       │                                         │                                            │
       │                              ┌──────────▼──────────┐         ┌──────────────────┐    │
       │                              │   PostgreSQL 16     │         │  Upstream        │    │
       │                              │  (config + logs +   │         │  services        │    │
       │                              │   analytics)        │         │  (your backends) │    │
       │                              └─────────────────────┘         └──────────────────┘    │
       │                                                                       ▲                │
       └─────────────────────────────────────────────────────────────────────┘                │
                                  proxied response from upstream
```

## Simpler Architecture (no Repository Pattern)

EdgeFlow intentionally uses a simpler architecture than traditional gateways:

```
┌──────────────────────────────────────────────────────────────────┐
│  Routes (Express routers)        — HTTP endpoint definitions      │
├──────────────────────────────────────────────────────────────────┤
│  Middlewares                     — auth, validation, logging,     │
│                                    rate limit, cache, error wrap  │
├──────────────────────────────────────────────────────────────────┤
│  Controllers                     — HTTP req/res orchestration     │
├──────────────────────────────────────────────────────────────────┤
│  Services                        — business logic + DB access     │
│                                    (uses pg Pool directly,        │
│                                     NO repository layer)          │
├──────────────────────────────────────────────────────────────────┤
│  Database                        — PostgreSQL + Redis              │
└──────────────────────────────────────────────────────────────────┘
```

**Why no repository layer?** For a single-process gateway with a limited number of entity types, the repository pattern adds indirection without adding testability or flexibility. Services use parameterized queries directly via the shared pg Pool. This keeps the codebase lean, reduces file count, and maintains direct SQL visibility for performance tuning.
