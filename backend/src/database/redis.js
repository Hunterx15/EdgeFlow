/**
 * EdgeFlow - Redis client with in-memory fallback
 *
 * Used for response cache, rate-limit counters, and circuit-breaker state.
 * If Redis is unreachable, falls back to an in-memory Map so the gateway
 * stays functional (logged loudly).
 */

const config = require('../config');
const logger = require('../utils/logger');

let client = null;
let fallbackMode = false;
const memoryStore = new Map();

class MemoryFallback {
  constructor() {
    logger.warn('redis: running in MEMORY FALLBACK mode - not safe for multi-instance');
    this._interval = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of memoryStore) {
        if (v.expiresAt && v.expiresAt <= now) memoryStore.delete(k);
      }
    }, 60000).unref?.();
  }
  async get(k) { const e = memoryStore.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= Date.now()) { memoryStore.delete(k); return null; } return e.value; }
  async set(k, v, ttl) { memoryStore.set(k, { value: v, expiresAt: ttl ? Date.now() + ttl * 1000 : null }); return 'OK'; }
  async del(k) { return memoryStore.delete(k) ? 1 : 0; }
  async incr(k) { const e = memoryStore.get(k) || { value: '0' }; const n = parseInt(e.value, 10) + 1; memoryStore.set(k, { value: String(n), expiresAt: e.expiresAt }); return n; }
  async expire(k, ttl) { const e = memoryStore.get(k); if (!e) return 0; e.expiresAt = Date.now() + ttl * 1000; return 1; }
  async ping() { return 'PONG'; }
  async info() { return 'redis_version:memory-fallback\nused_memory:0\n'; }
  async dbSize() { return memoryStore.size; }
  async flushAll() { memoryStore.clear(); return 'OK'; }
  async disconnect() { clearInterval(this._interval); memoryStore.clear(); }
}

let fallbackInstance = null;

async function getClient() {
  if (client) return client;
  if (!config.redis.enabled) {
    fallbackMode = true;
    if (!fallbackInstance) fallbackInstance = new MemoryFallback();
    return fallbackInstance;
  }
  try {
    const { createClient } = require('redis');
    client = createClient({
      url: config.redis.url,
      socket: { reconnectStrategy: (r) => r > 10 ? new Error('REDIS_MAX_RETRIES') : Math.min(r * 200, 2000) },
    });
    client.on('error', (err) => logger.error('redis: client error', { error: err.message }));
    client.on('ready', () => logger.info('redis: client ready'));
    await client.connect();
    return client;
  } catch (err) {
    logger.error('redis: failed to connect, using memory fallback', { error: err.message });
    fallbackMode = true;
    client = null;
    if (!fallbackInstance) fallbackInstance = new MemoryFallback();
    return fallbackInstance;
  }
}

function isFallback() { return fallbackMode || !config.redis.enabled; }

async function ping() {
  const start = Date.now();
  try {
    const c = await getClient();
    const res = await c.ping();
    return { ok: res === 'PONG', latencyMs: Date.now() - start, fallback: isFallback() };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message, fallback: isFallback() };
  }
}

async function info() {
  try {
    const c = await getClient();
    if (typeof c.info === 'function') return await c.info();
    return 'redis_version:memory-fallback\nused_memory:0\n';
  } catch { return 'redis_version:unknown\n'; }
}

async function dbSize() {
  try {
    const c = await getClient();
    if (typeof c.dbSize === 'function') return await c.dbSize();
    return memoryStore.size;
  } catch { return 0; }
}

async function close() {
  if (client && client.isOpen) { await client.quit(); client = null; }
  if (fallbackInstance) { await fallbackInstance.disconnect(); fallbackInstance = null; }
}

module.exports = { getClient, isFallback, ping, info, dbSize, close };
