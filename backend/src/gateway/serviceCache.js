/**
 * EdgeFlow - Service cache
 *
 * In-memory cache for service definitions and their upstream targets.
 * Avoids executing a PostgreSQL query on every single proxied request
 * (Stage 2: Service Load). Invalidation happens on mutations and
 * heartbeat updates.
 */

const servicesService = require('../services/servicesService');
const logger = require('../utils/logger');

let cache = new Map();
let lastRefreshedAt = 0;
let inFlightRefresh = null;
const REFRESH_INTERVAL_MS = 60_000;

async function refresh() {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const rows = await servicesService.list({ limit: 500, enabledOnly: false });
      const nextMap = new Map();
      for (const s of rows) {
        nextMap.set(s.id, s);
      }
      cache = nextMap;
      lastRefreshedAt = Date.now();
      logger.debug('serviceCache: refreshed', { count: nextMap.size });
    } catch (err) {
      logger.error('serviceCache: refresh failed', { error: err.message });
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

async function get(id) {
  if (!id) return null;
  // If cache is cold, load it
  if (cache.size === 0 && Date.now() - lastRefreshedAt > REFRESH_INTERVAL_MS) {
    await refresh();
  } else if (Date.now() - lastRefreshedAt > REFRESH_INTERVAL_MS) {
    refresh().catch(() => {});
  }
  let svc = cache.get(id);
  if (!svc) {
    // Cache miss — fetch directly from DB and cache it
    try {
      svc = await servicesService.getById(id);
      if (svc) cache.set(svc.id, svc);
    } catch (err) {
      return null;
    }
  }
  return svc;
}

function set(service) {
  if (service && service.id) {
    cache.set(service.id, service);
  }
}

function invalidate(id) {
  if (id) {
    cache.delete(id);
  } else {
    cache.clear();
    lastRefreshedAt = 0;
  }
}

async function warm() {
  await refresh();
}

function size() {
  return cache.size;
}

module.exports = { get, set, invalidate, refresh, warm, size };
