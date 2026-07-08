/**
 * EdgeFlow - Dashboard service
 *
 * Composes the dashboard homepage payload in a single round-trip:
 *   - Top-line metrics
 *   - Live request graph (per-minute)
 *   - Top services
 *   - Status code breakdown
 *   - Service registry summary
 *   - Live metrics (uptime, active req, RPS, P95)
 */

const analyticsService = require('./analyticsService');
const servicesService = require('./servicesService');
const { queryOne } = require('../database/pool');
const monitoringService = require('./monitoringService');

async function getOverview({ windowMinutes = 60 } = {}) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const [overviewAgg, liveGraph, topServices, serviceStats, totalServices, totalRoutes, totalApiKeys, totalLogs, statusBreakdown, p95, active, rps, status] = await Promise.all([
    analyticsService.overview({ since }),
    analyticsService.liveGraph({ minutes: Math.min(60, windowMinutes) }),
    analyticsService.topRoutes({ since }),
    servicesService.stats(),
    queryOne('SELECT COUNT(*)::int AS c FROM services').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::int AS c FROM routes').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::int AS c FROM api_keys WHERE enabled = TRUE AND (expires_at IS NULL OR expires_at > NOW())').catch(() => ({ c: 0 })),
    queryOne('SELECT COUNT(*)::bigint AS c FROM request_logs').catch(() => ({ c: 0 })),
    analyticsService.statusBreakdown({ since }),
    analyticsService.p95Latency({ since }),
    analyticsService.activeRequests(),
    analyticsService.requestsPerSecond({ windowSec: 60 }),
    monitoringService.fullStatus(),
  ]);
  return {
    window: { minutes: windowMinutes, since },
    metrics: {
      totalServices: totalServices?.c || 0,
      totalRoutes: totalRoutes?.c || 0,
      activeApiKeys: totalApiKeys?.c || 0,
      totalRequests: overviewAgg.totalRequests,
      successCount: overviewAgg.successCount,
      errorCount: overviewAgg.errorCount,
      successRate: overviewAgg.successRate,
      errorRate: overviewAgg.errorRate,
      avgLatencyMs: overviewAgg.avgLatencyMs,
      maxLatencyMs: overviewAgg.maxLatencyMs,
      cacheHitRate: overviewAgg.cacheHitRate,
      totalRequestLogs: Number(totalLogs?.c) || 0,
      p95LatencyMs: p95,
      activeRequests: active,
      requestsPerSecond: rps,
    },
    live: {
      uptimeSec: status.uptimeSec,
      circuitBreakerState: status.subsystems.circuitBreakers,
      redisMemoryUsed: status.subsystems.redis.memoryUsed,
      redisMemoryPeak: status.subsystems.redis.memoryPeak,
      pgConnections: status.subsystems.database.pool,
    },
    services: {
      healthy: Number(serviceStats.healthy) || 0,
      unhealthy: Number(serviceStats.unhealthy) || 0,
      unknown: Number(serviceStats.unknown) || 0,
      total: Number(serviceStats.total) || 0,
    },
    liveGraph,
    topServices: overviewAgg.topServices,
    topRoutes: topServices,
    statusBreakdown,
  };
}

module.exports = { getOverview };
