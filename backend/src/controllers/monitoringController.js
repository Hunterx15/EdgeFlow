/**
 * EdgeFlow - Monitoring / health / cache / circuit-breaker controller
 */

const monitoringService = require('../services/monitoringService');
const cacheService = require('../services/cacheService');
const circuitBreaker = require('../services/circuitBreaker');
const servicesService = require('../services/servicesService');
const { ok } = require('../utils/http');

async function liveness(_req, res, next) {
  try { return ok(res, await monitoringService.health()); }
  catch (err) { next(err); }
}

async function readiness(req, res, next) {
  try {
    const data = await monitoringService.fullStatus();
    const status = data.status === 'ok' ? 200 : data.status === 'degraded' ? 200 : 503;
    return res.status(status).json({ success: true, data });
  } catch (err) { next(err); }
}

async function cacheStats(_req, res, next) {
  try { return ok(res, await cacheService.stats()); }
  catch (err) { next(err); }
}

async function cacheFlush(_req, res, next) {
  try {
    // SECURITY FIX: Previously called cacheService.flushAll() which calls
    // redis.flushdb() — wiping the ENTIRE Redis DB including rate-limit
    // counters, circuit-breaker state, and any other services sharing the
    // Redis instance. Now we only invalidate cache:* keys.
    await cacheService.invalidatePattern('cache:*');
    return ok(res, { flushed: true, scope: 'cache:*' });
  } catch (err) { next(err); }
}

async function cacheInvalidate(req, res, next) {
  try {
    let pattern = req.body?.pattern || 'cache:*';
    // SECURITY: Enforce that the pattern only matches cache keys, never
    // rate-limit (rl:*) or circuit-breaker keys. If the caller passes a
    // pattern without the cache: prefix, prepend it.
    if (!pattern.startsWith('cache:')) {
      pattern = 'cache:*';
    }
    await cacheService.invalidatePattern(pattern);
    return ok(res, { invalidated: pattern });
  } catch (err) { next(err); }
}

async function circuitBreakers(_req, res, next) {
  try { return ok(res, circuitBreaker.listAll()); }
  catch (err) { next(err); }
}

async function resetCircuit(req, res, next) {
  try {
    // upstreamUrl is now passed in the body or query (not as a path param,
    // because URLs contain `/` which breaks Express path matching).
    const upstreamUrl = req.body?.upstreamUrl || req.query?.upstreamUrl;
    if (upstreamUrl) {
      const s = circuitBreaker.getState(upstreamUrl);
      s.state = 'closed'; s.failureCount = 0; s.successCount = 0; s.halfOpenInflight = 0;
    }
    return ok(res, { reset: true, upstreamUrl });
  } catch (err) { next(err); }
}

async function dependencyGraph(_req, res, next) {
  try {
    const services = await servicesService.list({ enabledOnly: false });
    return ok(res, {
      gateway: { name: 'EdgeFlow Gateway', status: 'healthy' },
      services: services.map((s) => ({
        id: s.id, name: s.name, slug: s.slug, status: s.last_status || 'unknown',
        enabled: s.enabled, version: s.version,
        upstreamTargets: s.upstream_targets,
      })),
    });
  } catch (err) { next(err); }
}

module.exports = {
  liveness, readiness, cacheStats, cacheFlush, cacheInvalidate,
  circuitBreakers, resetCircuit, dependencyGraph,
};
