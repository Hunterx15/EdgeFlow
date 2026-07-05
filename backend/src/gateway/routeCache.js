/**
 * EdgeFlow - Route cache
 *
 * The routes table is small and rarely changes, but every proxied
 * request needs a route lookup. We keep an in-memory cache keyed by
 * (method, publicPath) for exact matches and a prefix index for
 * wildcards. Invalidation is explicit after mutations.
 */

const routesService = require('../services/routesService');
const logger = require('../utils/logger');

let exactRoutes = new Map();
let wildcardRoutes = [];
let lastRefreshedAt = 0;
let warming = false;
const REFRESH_INTERVAL_MS = 60_000;

async function refresh() {
  if (warming) return;
  warming = true;
  try {
    const rows = await routesService.listAllEnabled();
    const nextExact = new Map();
    const nextWildcard = [];
    for (const r of rows) {
      if (r.public_path.endsWith('/*') || r.public_path.endsWith(':*')) {
        nextWildcard.push({ method: r.method.toUpperCase(), prefix: r.public_path.replace(/\/\*$/, ''), route: r });
      } else {
        nextExact.set(`${r.method.toUpperCase()}:${r.public_path}`, r);
      }
    }
    exactRoutes = nextExact;
    wildcardRoutes = nextWildcard;
    lastRefreshedAt = Date.now();
    logger.debug('routeCache: refreshed', { exact: nextExact.size, wildcard: nextWildcard.length });
  } catch (err) {
    logger.error('routeCache: refresh failed', { error: err.message });
  } finally {
    warming = false;
  }
}

async function match(method, publicPath) {
  if (Date.now() - lastRefreshedAt > REFRESH_INTERVAL_MS) await refresh();
  const m = method.toUpperCase();
  const exact = exactRoutes.get(`${m}:${publicPath}`);
  if (exact) return exact;
  let best = null; let bestLen = -1;
  for (const w of wildcardRoutes) {
    if (w.method !== m && w.method !== '*') continue;
    if (publicPath.startsWith(w.prefix + '/') || publicPath === w.prefix) {
      if (w.prefix.length > bestLen) { best = w.route; bestLen = w.prefix.length; }
    }
  }
  return best;
}

function invalidate() { lastRefreshedAt = 0; }
async function warm() { await refresh(); }
function size() { return exactRoutes.size + wildcardRoutes.length; }
function snapshot() {
  return {
    exact: Array.from(exactRoutes.keys()),
    wildcard: wildcardRoutes.map((w) => `${w.method}:${w.prefix}/*`),
    lastRefreshedAt,
  };
}

module.exports = { refresh, match, invalidate, warm, size, snapshot };
