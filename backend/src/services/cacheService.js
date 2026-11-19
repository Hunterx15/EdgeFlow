/**
 * EdgeFlow - Cache service (Redis-backed response cache)
 *
 * Cache key derived from route id + method + url. Only caches
 * successful (2xx) GET responses. TTL is per-route (cache_ttl_sec).
 */

const redis = require('../database/redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

const CACHEABLE_METHODS = new Set(['GET', 'HEAD']);

function buildCacheKey({ routeId, method, originalUrl, body = null }) {
  const bodyHash = body ? crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16) : '';
  return `cache:r:${routeId}:${method}:${originalUrl}${bodyHash ? `:${bodyHash}` : ''}`;
}

async function get(key) {
  try {
    const c = await redis.getClient();
    const raw = await c.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) { logger.warn('cache: get failed', { error: err.message, key }); return null; }
}

async function set(key, value, ttlSeconds) {
  if (!ttlSeconds || ttlSeconds <= 0) return false;

  try {
    const c = await redis.getClient();

    // node-redis v4+ accepts an options object: c.set(k, v, { EX: secs }).
    // Our MemoryFallback's set() signature is set(k, v, ttl) where ttl is a
    // number. Detect the client type and call accordingly so caching works
    // in BOTH real-Redis mode and fallback mode (otherwise the fallback
    // receives `{ EX: secs }` as ttl, computes NaN for expiresAt, and items
    // never expire, leaking memory indefinitely).
    if (redis.isFallback()) {
      // In-memory fallback: pass ttl as a number.
      await c.set(key, JSON.stringify(value), ttlSeconds);
    } else {
      // Real Redis: use the EX option.
      await c.set(key, JSON.stringify(value), { EX: ttlSeconds });
    }

    return true;
  } catch (err) {
    logger.warn("cache: set failed", {
      key,
      ttlSeconds,
      error: err.message,
    });

    return false;
  }
}

async function invalidate(key) {
  try { const c = await redis.getClient(); await c.del(key); return true; }
  catch (err) { logger.warn('cache: invalidate failed', { error: err.message, key }); return false; }
}

async function invalidatePattern(pattern) {
  try {
    const c = await redis.getClient();
    if (typeof c.scan === 'function') {
      let cursor = '0';
      do {
        const reply = await c.scan(cursor, { MATCH: pattern, COUNT: 200 });
        cursor = reply.cursor;
        if (reply.keys?.length) await c.del(reply.keys);
      } while (cursor !== '0' && cursor !== 0);
    }
    return true;
  } catch (err) { logger.warn('cache: invalidatePattern failed', { error: err.message, pattern }); return false; }
}

async function flushAll() {
  try {
    const c = await redis.getClient();
    if (typeof c.flushAll === 'function') await c.flushAll();
    else if (typeof c.flushdb === 'function') await c.flushdb();
    return true;
  } catch (err) { logger.error('cache: flushAll failed', { error: err.message }); return false; }
}

async function stats() {
  try {
    const c = await redis.getClient();
    if (typeof c.dbSize === 'function') return { keys: await c.dbSize() };
    return { keys: -1 };
  } catch { return { keys: -1 }; }
}

function isCacheable(method) { return CACHEABLE_METHODS.has(method.toUpperCase()); }

module.exports = { buildCacheKey, get, set, invalidate, invalidatePattern, flushAll, stats, isCacheable };
