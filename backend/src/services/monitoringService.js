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
  const [dbPing, redisPing, servicesStats, p95, active, rps, routeCount, apiKeyCount, logCount, latencyPercentiles] = await Promise.all([
    db.ping().catch((e) => ({ ok: false, error: e.message })),
    redis.ping().catch((e) => ({ ok: false, error: e.message })),
    servicesService.stats().catch(() => ({ healthy: 0, unhealthy: 0, unknown: 0, total: 0 })),
    analyticsService.p95Latency({ since: new Date(Date.now() - 60 * 60 * 1000).toISOString() }).catch(() => 0),
    analyticsService.activeRequests().catch(() => 0),
    analyticsService.requestsPerSecond({ windowSec: 60 }).catch(() => 0),
    queryOne('SELECT COUNT(*)::int AS c FROM routes').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::int AS c FROM api_keys WHERE enabled = TRUE AND (expires_at IS NULL OR expires_at > NOW())').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::bigint AS c FROM request_logs').catch(() => ({ c: 0 })),
    analyticsService.latencyPercentiles({ since: new Date(Date.now() - 60 * 60 * 1000).toISOString() }).catch(() => ({ p50: 0, p95: 0, p99: 0, avg: 0, max: 0 })),
  ]);

  // Redis memory info
  let redisMemoryUsed = 0;
  let redisMemoryPeak = 0;
  let redisConnectedClients = 0;
  let redisUptimeSec = 0;
  let redisOpsPerSec = 0;
  try {
    const info = await redis.info();
    const parsed = await parseRedisInfo(info);
    redisMemoryUsed = parseInt(parsed.used_memory || '0', 10);
    redisMemoryPeak = parseInt(parsed.used_memory_peak || '0', 10);
    redisConnectedClients = parseInt(parsed.connected_clients || '0', 10);
    redisUptimeSec = parseInt(parsed.uptime_in_seconds || '0', 10);
    redisOpsPerSec = parseInt(parsed.instantaneous_ops_per_sec || '0', 10);
  } catch {}

  // Node.js runtime metrics
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const nodeMetrics = {
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    heapUsedMB: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
    rss: memUsage.rss,
    rssMB: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
    external: memUsage.external,
    cpuUser: cpuUsage.user,
    cpuSystem: cpuUsage.system,
    // Event loop lag — measured via a delayed timer check
    eventLoopLagMs: await measureEventLoopLag().catch(() => 0),
    activeHandles: (process._getActiveHandles?.() || []).length,
    activeRequests: (process._getActiveRequests?.() || []).length,
    uptimeSec: Math.floor(process.uptime()),
  };

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
      connectedClients: redisConnectedClients,
      uptimeSec: redisUptimeSec,
      opsPerSec: redisOpsPerSec,
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
      details: cbList,
    },
    routeCache: { status: 'ok', routes: routeCache.size(), lastRefreshedAt: routeCache.snapshot().lastRefreshedAt || null },
    node: nodeMetrics,
    live: {
      p50LatencyMs: latencyPercentiles?.p50 || 0,
      p95LatencyMs: latencyPercentiles?.p95 || 0,
      p99LatencyMs: latencyPercentiles?.p99 || 0,
      avgLatencyMs: latencyPercentiles?.avg || 0,
      maxLatencyMs: latencyPercentiles?.max || 0,
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
  const anyDegraded = Object.values(subsystems).some((s) => s && s.status === 'degraded');
  return {
    status: anyDown ? 'down' : anyDegraded ? 'degraded' : 'ok',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    subsystems,
  };
}

// ── Measure event loop lag ──
// Schedules a 0ms timer and measures how long it actually takes to fire.
// The delay is the event loop lag — how backed up the loop is.
function measureEventLoopLag() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e6; // ms
      resolve(Math.round(lag * 100) / 100);
    });
  });
}

module.exports = { health, fullStatus, startedAt };
