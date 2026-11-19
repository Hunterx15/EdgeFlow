/**
 * EdgeFlow - API keys service
 *
 * Issue / list / revoke API keys. Plaintext key shown ONCE on creation.
 *
 * High-Throughput Optimizations:
 * 1. Redis Caching: Validated API keys are cached in Redis with a 5-minute TTL,
 *    eliminating repeated PostgreSQL queries on the proxy hot path.
 * 2. Usage Micro-Batching: Request counts and last_used_at timestamps are accumulated
 *    in memory and flushed in batches every 5 seconds, preventing row-lock contention.
 * 3. Cache Invalidation: Mutations (update/disable/revoke) immediately purge Redis cache.
 */

const { queryOne, queryMany, queryRaw } = require('../database/pool');
const { generateApiKey, parseApiKey } = require('../utils/apiKey');
const { NotFoundError, ValidationError } = require('../utils/http');
const redis = require('../database/redis');
const logger = require('../utils/logger');

const COLS = `id, key_id, key_hash, name, scopes, rate_limit_per_min, enabled,
  expires_at, last_used_at, total_requests, created_at, updated_at`;

const KEY_CACHE_TTL_SEC = 300; // 5 minutes
const usageAccumulator = new Map(); // id -> count

function cacheKey(keyId) {
  return `ef:apikey:${keyId}`;
}

async function invalidateCache(keyId) {
  if (!keyId) return;
  try {
    const c = await redis.getClient();
    await c.del(cacheKey(keyId));
  } catch (_) {}
}

function recordUsage(id) {
  const current = usageAccumulator.get(id) || 0;
  usageAccumulator.set(id, current + 1);
  if (usageAccumulator.size >= 50) {
    flushUsage().catch(() => {});
  }
}

async function flushUsage() {
  if (usageAccumulator.size === 0) return;
  const snapshot = new Map(usageAccumulator);
  usageAccumulator.clear();

  for (const [id, count] of snapshot) {
    queryRaw(
      'UPDATE api_keys SET last_used_at = NOW(), total_requests = total_requests + $1 WHERE id = $2',
      [count, id]
    ).catch((err) => {
      logger.warn('apiKeys: flushUsage failed', { error: err.message, id });
    });
  }
}

let usageTimer = null;
if (process.env.NODE_ENV !== 'test') {
  usageTimer = setInterval(() => {
    flushUsage().catch(() => {});
  }, 5000);
  usageTimer.unref?.();
}

async function getById(id) {
  const k = await queryOne(`SELECT ${COLS} FROM api_keys WHERE id = $1`, [id]);
  if (!k) throw new NotFoundError('API key');
  return k;
}

async function list({ limit = 100, offset = 0 } = {}) {
  return queryMany(`SELECT ${COLS} FROM api_keys ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
}

async function count() {
  const r = await queryOne('SELECT COUNT(*)::int AS c FROM api_keys');
  return r?.c || 0;
}

async function issue({ name, scopes = [], rateLimitPerMin = 100, expiresInDays = null, environment = 'live' }) {
  if (!name) throw new ValidationError('API key name is required');
  if (rateLimitPerMin < 1 || rateLimitPerMin > 100000) throw new ValidationError('rateLimitPerMin must be between 1 and 100000');
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
  const generated = generateApiKey({ environment, name });
  const stored = await queryOne(
    `INSERT INTO api_keys (key_id, key_hash, name, scopes, rate_limit_per_min, enabled, expires_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING ${COLS}`,
    [generated.keyId, generated.keyHash, name, JSON.stringify(scopes), rateLimitPerMin, expiresAt]
  );
  return { ...stored, plaintextKey: generated.fullKey };
}

async function update(id, patch) {
  const existing = await getById(id);
  const allowed = ['name', 'scopes', 'rate_limit_per_min', 'enabled', 'expires_at'];
  const sets = []; const values = []; let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'scopes') v = JSON.stringify(v);
    sets.push(`${k} = $${i++}`); values.push(v);
  }
  if (sets.length === 0) return existing;
  values.push(id);
  const updated = await queryOne(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`, values);
  await invalidateCache(existing.key_id);
  return updated;
}

async function setEnabled(id, enabled) {
  const existing = await getById(id);
  const updated = await queryOne(`UPDATE api_keys SET enabled = $1 WHERE id = $2 RETURNING ${COLS}`, [enabled, id]);
  if (!updated) throw new NotFoundError('API key');
  await invalidateCache(existing.key_id);
  return updated;
}

async function revoke(id) {
  const existing = await getById(id);
  await queryRaw('DELETE FROM api_keys WHERE id = $1', [id]);
  await invalidateCache(existing.key_id);
  return true;
}

async function validate(rawKey) {
  let parsed;
  try {
    parsed = parseApiKey(rawKey);
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  let key = null;
  const c = await redis.getClient();
  try {
    const cached = await c.get(cacheKey(parsed.keyId));
    if (cached) {
      key = typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
  } catch (_) {}

  if (!key) {
    key = await queryOne(
      `SELECT ${COLS} FROM api_keys WHERE key_id = $1 AND key_hash = $2 AND enabled = TRUE`,
      [parsed.keyId, parsed.secretHash]
    );
    if (key) {
      try {
        await c.set(cacheKey(parsed.keyId), JSON.stringify(key), KEY_CACHE_TTL_SEC);
      } catch (_) {}
    }
  }

  if (!key) return { valid: false, reason: 'Invalid API key' };
  if (key.key_hash !== parsed.secretHash || !key.enabled) {
    return { valid: false, reason: 'Invalid API key' };
  }
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return { valid: false, reason: 'API key expired' };
  }

  recordUsage(key.id);
  return { valid: true, apiKey: key };
}

module.exports = {
  getById,
  list,
  count,
  issue,
  update,
  setEnabled,
  revoke,
  validate,
  flushUsage,
};
