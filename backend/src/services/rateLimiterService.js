/**
 * EdgeFlow - Sliding-window rate limiter (Redis)
 *
 * Per (identity, route) we keep two counters - per-minute and per-hour.
 * Uses INCR + EXPIRE for O(1) work. Fails OPEN if Redis is down.
 */

const redis = require('../database/redis');
const config = require('../config');
const logger = require('../utils/logger');

function keyPrefix(identity, routeId, windowSec) {
  return `rl:${identity}:${routeId || 'global'}:${windowSec}`;
}

async function check({ identity, routeId, limitPerMin, limitPerHour }) {
  const minuteLimit = limitPerMin || config.rateLimit.maxRequests;
  const hourLimit = limitPerHour || config.rateLimit.hourMaxRequests;
  const now = Math.floor(Date.now() / 1000);
  const minuteBucket = Math.floor(now / 60);
  const hourBucket = Math.floor(now / 3600);
  const minuteKey = `${keyPrefix(identity, routeId, 60)}:${minuteBucket}`;
  const hourKey = `${keyPrefix(identity, routeId, 3600)}:${hourBucket}`;

  try {
    const c = await redis.getClient();
    let minuteCount, hourCount;
    if (typeof c.multi === 'function') {
      const pipe = c.multi();
      pipe.incr(minuteKey); pipe.expire(minuteKey, 70);
      pipe.incr(hourKey); pipe.expire(hourKey, 3700);
      const results = await pipe.exec();
      minuteCount = results?.[0] ?? 0; hourCount = results?.[2] ?? 0;
    } else {
      minuteCount = await c.incr(minuteKey); await c.expire(minuteKey, 70);
      hourCount = await c.incr(hourKey); await c.expire(hourKey, 3700);
    }
    const allowed = minuteCount <= minuteLimit && hourCount <= hourLimit;
    return {
      allowed,
      minute: { count: minuteCount, limit: minuteLimit, remaining: Math.max(0, minuteLimit - minuteCount) },
      hour: { count: hourCount, limit: hourLimit, remaining: Math.max(0, hourLimit - hourCount) },
    };
  } catch (err) {
    logger.error('rateLimiter: redis error, failing open', { error: err.message });
    return {
      allowed: true, degraded: true,
      minute: { count: 0, limit: minuteLimit, remaining: minuteLimit },
      hour: { count: 0, limit: hourLimit, remaining: hourLimit },
    };
  }
}

module.exports = { check };
