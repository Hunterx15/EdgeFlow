/**
 * EdgeFlow - Analytics controller
 */

const analyticsService = require('../services/analyticsService');
const { queryMany } = require('../database/pool');
const { ok } = require('../utils/http');

async function overview(req, res, next) {
  try {
    const windowMinutes = Math.min(1440, parseInt(req.query.windowMinutes, 10) || 60);
    const data = await analyticsService.overview({ since: new Date(Date.now() - windowMinutes * 60 * 1000).toISOString() });
    return ok(res, { window: { minutes: windowMinutes }, ...data });
  } catch (err) { next(err); }
}

async function perMinute(req, res, next) {
  try {
    const minutes = Math.min(1440, parseInt(req.query.minutes, 10) || 60);
    return ok(res, await analyticsService.liveGraph({ minutes }));
  } catch (err) { next(err); }
}

async function perService(req, res, next) {
  try {
    const windowMinutes = Math.min(1440, parseInt(req.query.windowMinutes, 10) || 60);
    const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const data = await queryMany(
      `SELECT a.service_id, s.name, s.slug,
         SUM(a.total_requests)::bigint AS requests,
         SUM(a.error_count)::bigint AS errors,
         COALESCE(AVG(a.avg_latency_ms * a.total_requests) / NULLIF(SUM(a.total_requests), 0), 0)::float AS avg_latency_ms,
         SUM(a.cache_hit_count)::bigint AS cache_hits
       FROM analytics a JOIN services s ON s.id = a.service_id
       WHERE a.bucket_minute >= $1
       GROUP BY a.service_id, s.name, s.slug ORDER BY requests DESC LIMIT 10`, [sinceIso]
    );
    return ok(res, data);
  } catch (err) { next(err); }
}

async function topRoutes(req, res, next) {
  try { return ok(res, await analyticsService.topRoutes(req.query)); }
  catch (err) { next(err); }
}

async function statusBreakdown(req, res, next) {
  try { return ok(res, await analyticsService.statusBreakdown(req.query)); }
  catch (err) { next(err); }
}

// ── New endpoints for enhanced analytics ──

async function latencyPercentiles(req, res, next) {
  try {
    const windowMinutes = Math.min(1440, parseInt(req.query.windowMinutes, 10) || 60);
    const data = await analyticsService.latencyPercentiles({
      since: new Date(Date.now() - windowMinutes * 60 * 1000).toISOString(),
    });
    return ok(res, { window: { minutes: windowMinutes }, ...data });
  } catch (err) { next(err); }
}

async function slowEndpoints(req, res, next) {
  try {
    const windowMinutes = Math.min(1440 * 7, parseInt(req.query.windowMinutes, 10) || 1440);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
    const data = await analyticsService.slowEndpoints({
      since: new Date(Date.now() - windowMinutes * 60 * 1000).toISOString(),
      limit,
    });
    return ok(res, data);
  } catch (err) { next(err); }
}

async function methodDistribution(req, res, next) {
  try {
    const windowMinutes = Math.min(1440, parseInt(req.query.windowMinutes, 10) || 1440);
    const data = await analyticsService.methodDistribution({
      since: new Date(Date.now() - windowMinutes * 60 * 1000).toISOString(),
    });
    return ok(res, data);
  } catch (err) { next(err); }
}

async function serviceDistribution(req, res, next) {
  try {
    const windowMinutes = Math.min(1440, parseInt(req.query.windowMinutes, 10) || 1440);
    const data = await analyticsService.serviceDistribution({
      since: new Date(Date.now() - windowMinutes * 60 * 1000).toISOString(),
    });
    return ok(res, data);
  } catch (err) { next(err); }
}

async function trafficHeatmap(req, res, next) {
  try {
    const days = Math.min(30, parseInt(req.query.days, 10) || 7);
    const data = await analyticsService.trafficHeatmap({ days });
    return ok(res, data);
  } catch (err) { next(err); }
}

module.exports = { overview, perMinute, perService, topRoutes, statusBreakdown, latencyPercentiles, slowEndpoints, methodDistribution, serviceDistribution, trafficHeatmap };
