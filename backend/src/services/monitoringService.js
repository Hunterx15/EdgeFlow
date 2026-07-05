/**
 * EdgeFlow - Monitoring service
 *
 * Aggregates health signals from every subsystem for /monitoring/ready:
 *   - HTTP server uptime
 *   - PostgreSQL ping + pool stats
 *   - Redis ping + memory usage + fallback flag
 *   - Service registry summary
 *   - Circuit breaker states
 *   - Route cache stats
 *   - Live metrics (active requests, RPS, P95)
 */

const db = require('../database/pool');
const redis = require('../database/redis');
const servicesService = require('./servicesService');
const circuitBreaker = require('./circuitBreaker');
const routeCache = require('../gateway/routeCache');
const analyticsService = require('./analyticsService');
const { queryOne } = require('../database/pool');

const startedAt = Date.now();

async function health() {
  return {
    status: 'ok',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
}

async function parseRedisInfo(infoText) {
  const out = {};
  for (const line of infoText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      out[k] = v;
    }
  }
  return out;
}

async function fullStatus() {
  const [dbPing, redisPing, servicesStats, p95, active, rps, routeCount, apiKeyCount, logCount] = await Promise.all([
    db.ping().catch((e) => ({ ok: false, error: e.message })),
    redis.ping().catch((e) => ({ ok: false, error: e.message })),
    servicesService.stats().catch(() => ({ healthy: 0, unhealthy: 0, unknown: 0, total: 0 })),
    analyticsService.p95Latency({ since: new Date(Date.now() - 60 * 60 * 1000).toISOString() }).catch(() => 0),
    analyticsService.activeRequests().catch(() => 0),
    analyticsService.requestsPerSecond({ windowSec: 60 }).catch(() => 0),
    queryOne('SELECT COUNT(*)::int AS c FROM routes').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::int AS c FROM api_keys WHERE enabled = TRUE AND (expires_at IS NULL OR expires_at > NOW())').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::bigint AS c FROM request_logs').catch(() => ({ c: 0 })),
  ]);

  // Redis memory info
  let redisMemoryUsed = 0;
  let redisMemoryPeak = 0;
  try {
    const info = await redis.info();
    const parsed = await parseRedisInfo(info);
    redisMemoryUsed = parseInt(parsed.used_memory || '0', 10);
    redisMemoryPeak = parseInt(parsed.used_memory_peak || '0', 10);
  } catch {}

  const cbList = circuitBreaker.listAll();
  const subsystems = {
    database: {
      status: dbPing.ok ? 'ok' : 'down',
      latencyMs: dbPing.latencyMs,
      pool: dbPing.pool || { total: 0, idle: 0, waiting: 0 },
      error: dbPing.error || null,
    },
    redis: {
      status: redisPing.ok ? 'ok' : 'down',
      latencyMs: redisPing.latencyMs,
      fallback: redis.isFallback(),
      memoryUsed: redisMemoryUsed,
      memoryPeak: redisMemoryPeak,
      dbSize: await redis.dbSize().catch(() => 0),
      error: redisPing.error || null,
    },
    services: {
      status: Number(servicesStats.unhealthy) > 0 ? 'degraded' : 'ok',
      healthy: Number(servicesStats.healthy) || 0,
      unhealthy: Number(servicesStats.unhealthy) || 0,
      unknown: Number(servicesStats.unknown) || 0,
      total: Number(servicesStats.total) || 0,
    },
    circuitBreakers: {
      status: cbList.some((c) => c.state === 'open') ? 'degraded' : 'ok',
      openCount: cbList.filter((c) => c.state === 'open').length,
      halfOpenCount: cbList.filter((c) => c.state === 'half_open').length,
      closedCount: cbList.filter((c) => c.state === 'closed').length,
    },
    routeCache: { status: 'ok', routes: routeCache.size(), lastRefreshedAt: routeCache.snapshot().lastRefreshedAt || null },
    live: {
      p95LatencyMs: p95,
      activeRequests: active,
      requestsPerSecond: rps,
    },
    counters: {
      totalRoutes: routeCount?.c || 0,
      activeApiKeys: apiKeyCount?.c || 0,
      totalRequestLogs: Number(logCount?.c) || 0,
    },
  };
  const anyDown = subsystems.database.status === 'down' || subsystems.redis.status === 'down';
  const anyDegraded = Object.values(subsystems).some((s) => s.status === 'degraded');
  return {
    status: anyDown ? 'down' : anyDegraded ? 'degraded' : 'ok',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    subsystems,
  };
}

module.exports = { health, fullStatus, startedAt };
