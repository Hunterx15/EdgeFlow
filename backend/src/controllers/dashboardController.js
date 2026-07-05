/**
 * EdgeFlow - Dashboard controller
 */

const dashboardService = require('../services/dashboardService');
const analyticsService = require('../services/analyticsService');
const monitoringService = require('../services/monitoringService');
const { ok } = require('../utils/http');

async function overview(req, res, next) {
  try {
    const windowMinutes = parseInt(req.query.windowMinutes, 10) || 60;
    const data = await dashboardService.getOverview({ windowMinutes });
    return ok(res, data);
  } catch (err) { next(err); }
}

async function liveGraph(req, res, next) {
  try {
    const minutes = parseInt(req.query.minutes, 10) || 60;
    const data = await analyticsService.liveGraph({ minutes });
    return ok(res, data);
  } catch (err) { next(err); }
}

async function liveMetrics(req, res, next) {
  try {
    const [p95, active, rps, status] = await Promise.all([
      analyticsService.p95Latency({ since: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
      analyticsService.activeRequests(),
      analyticsService.requestsPerSecond({ windowSec: 60 }),
      monitoringService.fullStatus(),
    ]);
    return ok(res, {
      uptimeSec: status.uptimeSec,
      activeRequests: active,
      requestsPerSecond: rps,
      p95LatencyMs: p95,
      circuitBreakers: status.subsystems.circuitBreakers,
      redisMemoryUsed: status.subsystems.redis.memoryUsed,
      redisMemoryPeak: status.subsystems.redis.memoryPeak,
      pgConnections: status.subsystems.database.pool,
      errorRate: status.subsystems.services.unhealthy > 0 ? (status.subsystems.services.unhealthy / status.subsystems.services.total) * 100 : 0,
    });
  } catch (err) { next(err); }
}

module.exports = { overview, liveGraph, liveMetrics };
