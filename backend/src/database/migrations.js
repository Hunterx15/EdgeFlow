/**
 * EdgeFlow - Database schema migrations
 *
 * Tiny in-house runner. Tracks applied migrations in schema_migrations
 * and runs them in order on boot. Each migration runs inside a tx.
 */

const logger = require('../utils/logger');
const { getPool, tx } = require('./pool');

const migrations = [
  {
    name: '0001_initial_schema',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email           VARCHAR(255) NOT NULL UNIQUE,
          name            VARCHAR(120) NOT NULL,
          password_hash   VARCHAR(255) NOT NULL,
          role            VARCHAR(32)  NOT NULL DEFAULT 'admin',
          is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
          last_login_at   TIMESTAMPTZ,
          refresh_token_jti VARCHAR(255),
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS services (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name            VARCHAR(120) NOT NULL UNIQUE,
          slug            VARCHAR(120) NOT NULL UNIQUE,
          description     TEXT,
          base_path       VARCHAR(255) NOT NULL,
          upstream_targets JSONB       NOT NULL,
          version         VARCHAR(32)  NOT NULL DEFAULT 'v1',
          enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
          health_check_path  VARCHAR(255) DEFAULT '/health',
          health_check_interval_ms INTEGER NOT NULL DEFAULT 30000,
          last_heartbeat_at TIMESTAMPTZ,
          last_status     VARCHAR(32),
          metadata        JSONB        NOT NULL DEFAULT '{}',
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS routes (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          method          VARCHAR(10)  NOT NULL,
          public_path     VARCHAR(255) NOT NULL,
          upstream_path   VARCHAR(255) NOT NULL DEFAULT '/',
          strip_prefix    BOOLEAN      NOT NULL DEFAULT TRUE,
          auth_required   BOOLEAN      NOT NULL DEFAULT TRUE,
          api_key_required BOOLEAN     NOT NULL DEFAULT FALSE,
          rate_limit_per_min INTEGER   NOT NULL DEFAULT 100,
          cache_ttl_sec   INTEGER      NOT NULL DEFAULT 0,
          description     TEXT,
          enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          UNIQUE (method, public_path)
        );
        CREATE INDEX IF NOT EXISTS idx_routes_service_id ON routes(service_id);
        CREATE INDEX IF NOT EXISTS idx_routes_public_path ON routes(public_path);

        CREATE TABLE IF NOT EXISTS api_keys (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          key_id          VARCHAR(64)  NOT NULL UNIQUE,
          key_hash        VARCHAR(255) NOT NULL UNIQUE,
          name            VARCHAR(120) NOT NULL,
          scopes          JSONB        NOT NULL DEFAULT '[]',
          rate_limit_per_min INTEGER   NOT NULL DEFAULT 100,
          enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
          expires_at      TIMESTAMPTZ,
          last_used_at    TIMESTAMPTZ,
          total_requests  BIGINT       NOT NULL DEFAULT 0,
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_id ON api_keys(key_id);

        CREATE TABLE IF NOT EXISTS request_logs (
          id              BIGSERIAL PRIMARY KEY,
          request_id      VARCHAR(64)  NOT NULL,
          method          VARCHAR(10)  NOT NULL,
          public_path     VARCHAR(512) NOT NULL,
          service_id      UUID REFERENCES services(id) ON DELETE SET NULL,
          route_id        UUID REFERENCES routes(id)   ON DELETE SET NULL,
          api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,
          upstream_url    VARCHAR(1024),
          status_code     INTEGER,
          latency_ms      INTEGER,
          response_size   INTEGER,
          error           TEXT,
          client_ip       VARCHAR(64),
          user_agent      VARCHAR(512),
          cache_hit       BOOLEAN      NOT NULL DEFAULT FALSE,
          retry_count     INTEGER      NOT NULL DEFAULT 0,
          pipeline_stages JSONB,
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_logs_created_at   ON request_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_logs_service_id   ON request_logs(service_id);
        CREATE INDEX IF NOT EXISTS idx_logs_status_code ON request_logs(status_code);

        CREATE TABLE IF NOT EXISTS analytics (
          id              BIGSERIAL PRIMARY KEY,
          bucket_minute   TIMESTAMPTZ  NOT NULL,
          service_id      UUID REFERENCES services(id) ON DELETE CASCADE,
          total_requests  BIGINT       NOT NULL DEFAULT 0,
          success_count   BIGINT       NOT NULL DEFAULT 0,
          error_count     BIGINT       NOT NULL DEFAULT 0,
          avg_latency_ms  NUMERIC(10,2) NOT NULL DEFAULT 0,
          max_latency_ms  INTEGER      NOT NULL DEFAULT 0,
          cache_hit_count BIGINT       NOT NULL DEFAULT 0,
          UNIQUE (bucket_minute, service_id)
        );
        CREATE INDEX IF NOT EXISTS idx_analytics_bucket ON analytics(bucket_minute DESC);

        CREATE TABLE IF NOT EXISTS circuit_breaker_state (
          upstream_url    VARCHAR(512) PRIMARY KEY,
          state           VARCHAR(16)  NOT NULL DEFAULT 'closed',
          failure_count   INTEGER      NOT NULL DEFAULT 0,
          success_count   INTEGER      NOT NULL DEFAULT 0,
          opened_at       TIMESTAMPTZ,
          updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS schema_migrations (
          name            VARCHAR(255) PRIMARY KEY,
          applied_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );

        CREATE OR REPLACE FUNCTION trigger_set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
        $$ LANGUAGE plpgsql;

        -- BUG FIX: do NOT redefine gen_random_uuid(). PostgreSQL 13+ ships
        -- it natively, and older versions get it from the pgcrypto extension.
        -- The previous custom definition tried to call gen_random_bytes()
        -- which only exists in pgcrypto, so on PG 13+ (where gen_random_uuid
        -- is native) this would either shadow the native function with a
        -- broken one, or fail outright on PG <13 without pgcrypto enabled.
        -- The native function is correct; we rely on it.
      `);

      // Add updated_at triggers
      for (const t of ['users', 'services', 'routes', 'api_keys']) {
        await client.query(`
          DROP TRIGGER IF EXISTS set_updated_at ON ${t};
          CREATE TRIGGER set_updated_at BEFORE UPDATE ON ${t}
            FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
        `);
      }
    },
  },
];

async function migrate() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    logger.info(`migrations: applying ${m.name}`);
    await tx(async (client) => {
      await m.up(client);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [m.name]);
    });
    logger.info(`migrations: applied ${m.name}`);
  }
}

module.exports = { migrate, migrations };
