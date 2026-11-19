/**
 * EdgeFlow - Sliding-window rate limiter (Redis)
 *
 * Implements Cloudflare's sliding-window counter approximation:
 *   count = current_window_count + previous_window_count * ((window_size - current_offset) / window_size)
 *
 * Per (identity, route) we keep two sliding windows:
 *   - 1 minute window (limitPerMin)
 *   - 1 hour window (limitPerHour)
 *
 * Executed in a single atomic Redis MULTI pipeline (1 network round-trip).
 * Eliminates the 2x burst vulnerability at fixed window boundaries.
 * Fails OPEN if Redis is down.
 */

const redis = require('../database/redis');
const config = require('../config');
const logger = require('../utils/logger');

function keyPrefix(identity, routeId, windowSec) {
  return `rl:${identity}:${routeId || 'global'}:${windowSec}`;
}

async function check({ identity, routeId, limitPerMin, limitPerHour }) {
  const minuteLimit = limitPerMin || config.rateLimit.maxRequests;
  const hourLimit = limitPerHour || (limitPerMin ? limitPerMin * 60 : config.rateLimit.hourMaxRequests);
  const now = Math.floor(Date.now() / 1000);

  const curMinBucket = Math.floor(now / 60);
  const prevMinBucket = curMinBucket - 1;
  const curHourBucket = Math.floor(now / 3600);
  const prevHourBucket = curHourBucket - 1;

  const curMinKey = `${keyPrefix(identity, routeId, 60)}:${curMinBucket}`;
  const prevMinKey = `${keyPrefix(identity, routeId, 60)}:${prevMinBucket}`;
  const curHourKey = `${keyPrefix(identity, routeId, 3600)}:${curHourBucket}`;
  const prevHourKey = `${keyPrefix(identity, routeId, 3600)}:${prevHourBucket}`;

  try {
    const c = await redis.getClient();
    let curMin = 0;
    let prevMinVal = 0;
    let curHour = 0;
    let prevHourVal = 0;

    if (typeof c.multi === 'function') {
      const pipe = c.multi();
      pipe.incr(curMinKey);
      pipe.expire(curMinKey, 120);
      pipe.get(prevMinKey);
      pipe.incr(curHourKey);
      pipe.expire(curHourKey, 7200);
      pipe.get(prevHourKey);

      const results = await pipe.exec();
      curMin = results?.[0] ?? 0;
      prevMinVal = parseInt(results?.[2] || '0', 10) || 0;
      curHour = results?.[3] ?? 0;
      prevHourVal = parseInt(results?.[5] || '0', 10) || 0;
    } else {
      curMin = await c.incr(curMinKey);
      await c.expire(curMinKey, 120);
      const prevMinRaw = await c.get(prevMinKey);
      prevMinVal = parseInt(prevMinRaw || '0', 10) || 0;

      curHour = await c.incr(curHourKey);
      await c.expire(curHourKey, 7200);
      const prevHourRaw = await c.get(prevHourKey);
      prevHourVal = parseInt(prevHourRaw || '0', 10) || 0;
    }

    // Cloudflare sliding window formula:
    const minWeight = (60 - (now % 60)) / 60;
    const minuteCount = Math.round(curMin + prevMinVal * minWeight);

    const hourWeight = (3600 - (now % 3600)) / 3600;
    const hourCount = Math.round(curHour + prevHourVal * hourWeight);

    const allowed = minuteCount <= minuteLimit && hourCount <= hourLimit;
    return {
      allowed,
      minute: { count: minuteCount, limit: minuteLimit, remaining: Math.max(0, minuteLimit - minuteCount) },
      hour: { count: hourCount, limit: hourLimit, remaining: Math.max(0, hourLimit - hourCount) },
    };
  } catch (err) {
    logger.error('rateLimiter: redis error, failing open', { error: err.message });
    return {
      allowed: true,
      degraded: true,
      minute: { count: 0, limit: minuteLimit, remaining: minuteLimit },
      hour: { count: 0, limit: hourLimit, remaining: hourLimit },
    };
  }
}

module.exports = { check };
