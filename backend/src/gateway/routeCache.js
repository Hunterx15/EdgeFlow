/**
 * EdgeFlow - Route cache
 *
 * The routes table is small and rarely changes, but every proxied
 * request needs a route lookup. We keep an in-memory cache keyed by
 * (method, publicPath) for exact matches and a prefix index for
 * wildcards. Invalidation is explicit after mutations.
 *
 * BUG FIX: previously `refresh()` was called inside `match()` when the
 * cache was stale. If many requests arrived at once, multiple refresh()
 * calls would race (the `warming` flag was set, but other callers still
 * issued redundant DB queries because the `if (warming) return;` only
 * skipped the body, not the await). We now properly deduplicate by
 * tracking the in-flight refresh Promise and returning it for concurrent
 * callers.
 */

const routesService = require("../services/routesService");
const logger = require("../utils/logger");

let exactRoutes = new Map();
let wildcardRoutes = [];
let lastRefreshedAt = 0;
let inFlightRefresh = null;
const REFRESH_INTERVAL_MS = 60_000;

async function refresh() {
  // Deduplicate concurrent refresh calls — they all share one Promise.
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const rows = await routesService.listAllEnabled();
      const nextExact = new Map();
      const nextWildcard = [];
      for (const r of rows) {
        if (r.public_path.endsWith("/*") || r.public_path.endsWith(":*")) {
          nextWildcard.push({
            method: r.method.toUpperCase(),
            prefix: r.public_path.replace(/\/\*$/, ""),
            route: r,
          });
        } else {
          nextExact.set(`${r.method.toUpperCase()}:${r.public_path}`, r);
        }
      }
      exactRoutes = nextExact;
      wildcardRoutes = nextWildcard;
      lastRefreshedAt = Date.now();
      logger.debug("routeCache: refreshed", {
        exact: nextExact.size,
        wildcard: nextWildcard.length,
      });
    } catch (err) {
      logger.error("routeCache: refresh failed", { error: err.message });
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

async function match(method, publicPath) {
  // Refresh in the background if stale, but don't block initial requests
  // when we already have *something* in the cache. If the cache is empty
  // (cold start), we DO await the refresh.
  if (Date.now() - lastRefreshedAt > REFRESH_INTERVAL_MS) {
    if (exactRoutes.size === 0 && wildcardRoutes.length === 0) {
      await refresh();
    } else {
      // Fire-and-forget refresh — current request uses stale cache.
      refresh().catch(() => {});
    }
  }
  const m = method.toUpperCase();
  const exact = exactRoutes.get(`${m}:${publicPath}`);
  if (exact) return exact;
  let best = null;
  let bestLen = -1;
  for (const w of wildcardRoutes) {
    if (w.method !== m && w.method !== "*") continue;
    if (publicPath.startsWith(w.prefix + "/") || publicPath === w.prefix) {
      if (w.prefix.length > bestLen) {
        best = w.route;
        bestLen = w.prefix.length;
      }
    }
  }
  return best;
}

function invalidate() {
  lastRefreshedAt = 0;
}
async function warm() {
  await refresh();
}
function size() {
  return exactRoutes.size + wildcardRoutes.length;
}
function snapshot() {
  return {
    exact: Array.from(exactRoutes.keys()),
    wildcard: wildcardRoutes.map((w) => `${w.method}:${w.prefix}/*`),
    lastRefreshedAt,
  };
}

module.exports = { refresh, match, invalidate, warm, size, snapshot };
