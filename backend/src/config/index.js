/**
 * EdgeFlow - Centralized Application Configuration
 *
 * All environment-driven configuration is loaded and validated here.
 * The rest of the codebase MUST consume config from this module
 * instead of reading process.env directly.
 *
 * Production safety:
 *   In production mode, the config validates that critical secrets
 *   (JWT_SECRET, JWT_REFRESH_SECRET, SEED_ADMIN_PASSWORD, DATABASE_URL)
 *   are set and do NOT match the insecure dev defaults. If they do, the
 *   process exits with a clear error — preventing accidental deployment
 *   with forgeable JWTs or a known admin password.
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const toInt = (v, f) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : f; };
const toBool = (v, f = false) => {
  if (v === undefined || v === null || v === '') return f;
  const lower = String(v).toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
};

// ── Deep freeze — prevents accidental mutation of nested config objects ──
function deepFreeze(obj) {
  Object.keys(obj).forEach((key) => {
    const prop = obj[key];
    if (typeof prop === 'object' && prop !== null && !Array.isArray(prop)) {
      deepFreeze(prop);
    }
  });
  return Object.freeze(obj);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',

  server: {
    port: toInt(process.env.PORT, 4000),
    host: process.env.HOST || '0.0.0.0',
    apiPrefix: process.env.API_PREFIX || '/api/v1',
    gatewayPrefix: process.env.GATEWAY_PREFIX || '/gateway',
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
      .split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimit: process.env.BODY_LIMIT || '1mb',
    // Number of proxies between the public internet and EdgeFlow.
    // Set to 1 for a single reverse proxy (Render, nginx, Cloudflare).
    // This makes req.ip, req.secure, and req.protocol reflect the real
    // client, not the proxy.
    trustProxy: toInt(process.env.TRUST_PROXY, 1),
  },

  database: {
    url: process.env.DATABASE_URL || 'postgresql://edgeflow:edgeflow@localhost:5432/edgeflow',
    host: process.env.DB_HOST || 'localhost',
    port: toInt(process.env.DB_PORT, 5432),
    name: process.env.DB_NAME || 'edgeflow',
    user: process.env.DB_USER || 'edgeflow',
    password: process.env.DB_PASSWORD || 'edgeflow',
    poolMin: toInt(process.env.DB_POOL_MIN, 2),
    poolMax: toInt(process.env.DB_POOL_MAX, 10),
    idleTimeoutMs: toInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMs: toInt(process.env.DB_CONN_TIMEOUT_MS, 5000),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || '',
    db: toInt(process.env.REDIS_DB, 0),
    enabled: toBool(process.env.REDIS_ENABLED, true),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'edgeflow:',
    defaultTtl: toInt(process.env.REDIS_DEFAULT_TTL, 60),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'edgeflow-dev-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'edgeflow-dev-refresh-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'edgeflow',
    audience: process.env.JWT_AUDIENCE || 'edgeflow-dashboard',
  },

  bcrypt: { saltRounds: toInt(process.env.BCRYPT_SALT_ROUNDS, 12) },

  rateLimit: {
    windowSec: toInt(process.env.RATE_LIMIT_WINDOW_SEC, 60),
    maxRequests: toInt(process.env.RATE_LIMIT_MAX, 100),
    hourMaxRequests: toInt(process.env.RATE_LIMIT_HOUR_MAX, 5000),
  },

  gateway: {
    requestTimeoutMs: toInt(process.env.GATEWAY_TIMEOUT_MS, 30000),
    maxRetries: toInt(process.env.GATEWAY_MAX_RETRIES, 1),
    retryDelayMs: toInt(process.env.GATEWAY_RETRY_DELAY_MS, 200),
    // Max upstream response size to buffer (for cacheable routes). Larger
    // responses are streamed directly to the client without caching.
    maxBufferBytes: toInt(process.env.GATEWAY_MAX_BUFFER_BYTES, 2 * 1024 * 1024),
    circuitBreaker: {
      failureThreshold: toInt(process.env.CB_FAILURE_THRESHOLD, 5),
      successThreshold: toInt(process.env.CB_SUCCESS_THRESHOLD, 2),
      openStateMs: toInt(process.env.CB_OPEN_MS, 30000),
      halfOpenMaxCalls: toInt(process.env.CB_HALF_OPEN_MAX, 3),
    },
    healthCheck: {
      intervalMs: toInt(process.env.HEALTH_CHECK_INTERVAL_MS, 30000),
      timeoutMs: toInt(process.env.HEALTH_CHECK_TIMEOUT_MS, 5000),
      unhealthyThreshold: toInt(process.env.UNHEALTHY_THRESHOLD, 3),
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'pretty',
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@edgeflow.dev',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
    adminName: process.env.SEED_ADMIN_NAME || 'EdgeFlow Admin',
  },
};

// ── Production fail-fast validation ──
//
// In production, refuse to boot if critical secrets are missing or match
// the insecure dev defaults. This prevents accidental deployment with
// forgeable JWTs or a publicly-known admin password.
if (config.isProduction) {
  const INSECURE_DEFAULTS = [
    'edgeflow-dev-secret-change-me',
    'edgeflow-dev-refresh-secret-change-me',
  ];
  const errors = [];

  if (!process.env.JWT_SECRET || INSECURE_DEFAULTS.includes(config.jwt.secret)) {
    errors.push('JWT_SECRET must be set to a secure value in production');
  }
  if (!process.env.JWT_REFRESH_SECRET || INSECURE_DEFAULTS.includes(config.jwt.refreshSecret)) {
    errors.push('JWT_REFRESH_SECRET must be set to a secure value in production');
  }
  if (!process.env.SEED_ADMIN_PASSWORD || config.seed.adminPassword === 'Admin@12345') {
    errors.push('SEED_ADMIN_PASSWORD must be changed from the default in production');
  }
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL must be set in production');
  }
  if (config.jwt.secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters in production');
  }

  if (errors.length > 0) {
    console.error('\n❌ FATAL: Production config validation failed:\n');
    errors.forEach((e) => console.error(`   • ${e}`));
    console.error('\n   Refusing to boot. Set the required environment variables.\n');
    process.exit(1);
  }
}

deepFreeze(config);
module.exports = config;
