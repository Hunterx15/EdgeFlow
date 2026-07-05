# EdgeFlow - Database ER Diagram

```
┌────────────────────────────────┐         ┌──────────────────────────────────┐
│           users                │         │            services              │
├────────────────────────────────┤         ├──────────────────────────────────┤
│ id           UUID PK           │         │ id              UUID PK          │
│ email        VARCHAR UNIQUE    │         │ name            VARCHAR UNIQUE   │
│ name         VARCHAR           │         │ slug            VARCHAR UNIQUE   │
│ password_hash VARCHAR          │         │ description     TEXT             │
│ role         VARCHAR           │         │ base_path       VARCHAR          │
│ is_active    BOOLEAN           │         │ upstream_targets JSONB           │
│ last_login_at TIMESTAMPTZ      │         │ version         VARCHAR          │
│ refresh_token_jti VARCHAR      │         │ enabled         BOOLEAN          │
│ created_at   TIMESTAMPTZ       │◀────┐   │ health_check_path VARCHAR        │
│ updated_at   TIMESTAMPTZ       │     │   │ health_check_interval_ms INT     │
└────────────────────────────────┘     │   │ last_heartbeat_at TIMESTAMPTZ    │
                                       │   │ last_status     VARCHAR          │
                                       │   │ metadata        JSONB            │
                                       │   │ created_at      TIMESTAMPTZ      │
                                       │   │ updated_at      TIMESTAMPTZ      │
                                       │   └──────────────┬───────────────────┘
                                       │                  │ 1
                                       │                  │
                                       │                  │ N
                                       │                  ▼
                                       │   ┌──────────────────────────────────┐
                                       │   │            routes                │
                                       │   ├──────────────────────────────────┤
                                       │   │ id              UUID PK          │
                                       │   │ service_id      UUID FK ─────────┘
                                       │   │ method          VARCHAR
                                       │   │ public_path     VARCHAR
                                       │   │ upstream_path   VARCHAR
                                       │   │ strip_prefix    BOOLEAN
                                       │   │ auth_required   BOOLEAN
                                       │   │ api_key_required BOOLEAN
                                       │   │ rate_limit_per_min INTEGER
                                       │   │ cache_ttl_sec   INTEGER
                                       │   │ description     TEXT
                                       │   │ enabled         BOOLEAN
                                       │   │ created_at      TIMESTAMPTZ
                                       │   │ updated_at      TIMESTAMPTZ
                                       │   │ UNIQUE (method, public_path)
                                       │   └──────────────────────────────────┘
                                       │
┌────────────────────────────────┐     │
│          api_keys              │     │
├────────────────────────────────┤     │
│ id              UUID PK        │     │
│ key_id          VARCHAR UNIQUE │     │
│ key_hash        VARCHAR UNIQUE │     │
│ name            VARCHAR        │     │
│ scopes          JSONB          │     │
│ rate_limit_per_min INTEGER     │     │
│ enabled         BOOLEAN        │     │
│ expires_at      TIMESTAMPTZ    │     │
│ last_used_at    TIMESTAMPTZ    │     │
│ total_requests  BIGINT         │     │
│ created_at      TIMESTAMPTZ    │     │
│ updated_at      TIMESTAMPTZ    │     │
└─────────────┬──────────────────┘     │
              │                        │
              │  N                     │
              │                        │ 1
              ▼                        │
┌──────────────────────────────────────┴────────────────────────────┐
│                          request_logs                              │
├───────────────────────────────────────────────────────────────────┤
│ id              BIGSERIAL PK                                      │
│ request_id      VARCHAR                                           │
│ method          VARCHAR                                           │
│ public_path     VARCHAR                                           │
│ service_id      UUID FK ──────────► services.id (SET NULL)         │
│ route_id        UUID FK ──────────► routes.id   (SET NULL)         │
│ api_key_id      UUID FK ──────────► api_keys.id (SET NULL)         │
│ upstream_url    VARCHAR                                           │
│ status_code     INTEGER                                           │
│ latency_ms      INTEGER                                           │
│ response_size   INTEGER                                           │
│ error           TEXT                                               │
│ client_ip       VARCHAR                                           │
│ user_agent      VARCHAR                                           │
│ cache_hit       BOOLEAN                                           │
│ retry_count     INTEGER                                           │
│ pipeline_stages JSONB                                             │
│ created_at      TIMESTAMPTZ                                       │
│ INDEXES: created_at, service_id, status_code, route_id            │
└───────────────────────────────────────────────────────────────────┘

┌────────────────────────────────┐    ┌──────────────────────────────────┐
│          analytics             │    │    circuit_breaker_state         │
├────────────────────────────────┤    ├──────────────────────────────────┤
│ id              BIGSERIAL PK   │    │ upstream_url   VARCHAR PK        │
│ bucket_minute   TIMESTAMPTZ    │    │ state          VARCHAR            │
│ service_id      UUID FK ───────┼───▶│ failure_count  INTEGER            │
│ total_requests  BIGINT         │    │ success_count  INTEGER            │
│ success_count   BIGINT         │    │ opened_at      TIMESTAMPTZ        │
│ error_count     BIGINT         │    │ updated_at     TIMESTAMPTZ        │
│ avg_latency_ms  NUMERIC(10,2)  │    └──────────────────────────────────┘
│ max_latency_ms  INTEGER        │
│ cache_hit_count BIGINT         │    ┌──────────────────────────────────┐
│ UNIQUE (bucket_minute, svc_id) │    │       schema_migrations          │
└────────────────────────────────┘    ├──────────────────────────────────┤
                                      │ name          VARCHAR PK         │
                                      │ applied_at    TIMESTAMPTZ         │
                                      └──────────────────────────────────┘
```

## Relationships

- `services` 1 ──── N `routes` (CASCADE on service delete)
- `services` 1 ──── N `request_logs` (SET NULL on service delete)
- `services` 1 ──── N `analytics` (CASCADE on service delete)
- `routes` 1   ──── N `request_logs` (SET NULL on route delete)
- `api_keys` 1 ──── N `request_logs` (SET NULL on api_key delete)

## Indexes

- `idx_routes_service_id` — fast lookup of routes by service
- `idx_routes_public_path` — fast route matching
- `idx_api_keys_key_id` — O(log n) API key lookup
- `idx_logs_created_at` — recent-logs queries
- `idx_logs_service_id` — per-service log queries
- `idx_logs_status_code` — filter by status class
- `idx_analytics_bucket` — dashboard aggregate queries

All tables have an `updated_at` trigger that keeps the column honest without app code.
