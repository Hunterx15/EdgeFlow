/**
 * EdgeFlow - Analytics service
 *
 * Micro-batches per-minute rollups in memory and flushes to PostgreSQL
 * periodically to avoid lock contention on high-throughput routes.
 * Provides aggregate queries for the dashboard.
 */

const { queryOne, queryMany, queryRaw } = require("../database/pool");
const logger = require("../utils/logger");

const FLUSH_INTERVAL_MS = 1000;
let analyticsBuffer = new Map();
let isFlushing = false;

let timer = null;
if (process.env.NODE_ENV !== 'test') {
  timer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

function record({ serviceId, statusCode, latencyMs, cacheHit }) {
  if (!serviceId) return;
  const bucketMinute = new Date();
  bucketMinute.setSeconds(0, 0);
  const key = `${bucketMinute.getTime()}:${serviceId}`;

  const success = statusCode >= 200 && statusCode < 400 ? 1 : 0;
  const error = statusCode >= 400 ? 1 : 0;
  const lat = Number(latencyMs || 0);

  let b = analyticsBuffer.get(key);
  if (!b) {
    b = {
      bucketMinute,
      serviceId,
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      cacheHitCount: 0,
      latencySum: 0,
      maxLatencyMs: 0,
    };
    analyticsBuffer.set(key, b);
  }

  b.totalRequests += 1;
  b.successCount += success;
  b.errorCount += error;
  b.cacheHitCount += cacheHit ? 1 : 0;
  b.latencySum += lat;
  b.maxLatencyMs = Math.max(b.maxLatencyMs, Math.round(lat));

  if (analyticsBuffer.size >= 50 && !isFlushing) {
    flush().catch(() => {});
  }
}

async function flush() {
  if (analyticsBuffer.size === 0 || isFlushing) return;
  isFlushing = true;

  const entries = Array.from(analyticsBuffer.values());
  analyticsBuffer.clear();

  for (const b of entries) {
    try {
      const avgLat = b.totalRequests > 0 ? b.latencySum / b.totalRequests : 0;
      await queryRaw(
        `INSERT INTO analytics (bucket_minute, service_id, total_requests, success_count, error_count,
           avg_latency_ms, max_latency_ms, cache_hit_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bucket_minute, service_id) DO UPDATE SET
           total_requests = analytics.total_requests + EXCLUDED.total_requests,
           success_count = analytics.success_count + EXCLUDED.success_count,
           error_count = analytics.error_count + EXCLUDED.error_count,
           cache_hit_count = analytics.cache_hit_count + EXCLUDED.cache_hit_count,
           avg_latency_ms = (analytics.avg_latency_ms * analytics.total_requests + EXCLUDED.avg_latency_ms * EXCLUDED.total_requests) / (analytics.total_requests + EXCLUDED.total_requests),
           max_latency_ms = GREATEST(analytics.max_latency_ms, EXCLUDED.max_latency_ms)`,
        [
          b.bucketMinute,
          b.serviceId,
          b.totalRequests,
          b.successCount,
          b.errorCount,
          avgLat,
          b.maxLatencyMs,
          b.cacheHitCount,
        ],
      );
    } catch (err) {
      logger.warn("analytics: flush failed", { error: err.message, serviceId: b.serviceId });
    }
  }

  isFlushing = false;
}

async function overview({ since } = {}) {
  const sinceIso =
    since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [agg, services] = await Promise.all([
    queryOne(
      `SELECT
         SUM(total_requests)::bigint AS total_requests,
         SUM(success_count)::bigint AS success_count,
         SUM(error_count)::bigint AS error_count,
         COALESCE(AVG(avg_latency_ms * total_requests) / NULLIF(SUM(total_requests), 0), 0)::float AS avg_latency_ms,
         COALESCE(MAX(max_latency_ms), 0)::int AS max_latency_ms,
         SUM(cache_hit_count)::bigint AS cache_hit_count
       FROM analytics WHERE bucket_minute >= $1`,
      [sinceIso],
    ),
    queryMany(
      `SELECT a.service_id, s.name, s.slug,
         SUM(a.total_requests)::bigint AS requests,
         SUM(a.error_count)::bigint AS errors,
         COALESCE(AVG(a.avg_latency_ms * a.total_requests) / NULLIF(SUM(a.total_requests), 0), 0)::float AS avg_latency_ms,
         SUM(a.cache_hit_count)::bigint AS cache_hits
       FROM analytics a JOIN services s ON s.id = a.service_id
       WHERE a.bucket_minute >= $1
       GROUP BY a.service_id, s.name, s.slug ORDER BY requests DESC LIMIT 5`,
      [sinceIso],
    ),
  ]);
  const total = Number(agg?.total_requests) || 0;
  const success = Number(agg?.success_count) || 0;
  const errors = Number(agg?.error_count) || 0;
  const cacheHits = Number(agg?.cache_hit_count) || 0;
  return {
    since: sinceIso,
    totalRequests: total,
    successCount: success,
    errorCount: errors,
    successRate: total > 0 ? (success / total) * 100 : 100,
    errorRate: total > 0 ? (errors / total) * 100 : 0,
    avgLatencyMs: Number(agg?.avg_latency_ms) || 0,
    maxLatencyMs: Number(agg?.max_latency_ms) || 0,
    cacheHitRate: total > 0 ? (cacheHits / total) * 100 : 0,
    topServices: services.map((s) => ({
      id: s.service_id,
      name: s.name,
      slug: s.slug,
      requests: Number(s.requests) || 0,
      errors: Number(s.errors) || 0,
      avgLatencyMs: Number(s.avg_latency_ms) || 0,
      cacheHits: Number(s.cache_hits) || 0,
    })),
  };
}

async function liveGraph({ since } = {}) {
  const sinceIso =
    since || new Date(Date.now() - 30 * 60 * 1000).toISOString();
  return queryMany(
    `SELECT
       bucket_minute,
       SUM(total_requests)::bigint AS requests,
       SUM(error_count)::bigint AS errors,
       COALESCE(AVG(avg_latency_ms * total_requests) / NULLIF(SUM(total_requests), 0), 0)::float AS latency_ms,
       SUM(cache_hit_count)::bigint AS cache_hits
     FROM analytics
     WHERE bucket_minute >= $1
     GROUP BY bucket_minute
     ORDER BY bucket_minute ASC`,
    [sinceIso],
  );
}

async function topRoutes({ since } = {}) {
  const sinceIso =
    since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return queryMany(
    `SELECT public_path, method,
       COUNT(*)::bigint AS requests,
       COALESCE(AVG(latency_ms), 0)::float AS avg_latency_ms,
       COUNT(*) FILTER (WHERE status_code >= 400)::bigint AS errors
     FROM request_logs WHERE created_at >= $1
     GROUP BY public_path, method ORDER BY requests DESC LIMIT 10`,
    [sinceIso],
  );
}

async function statusBreakdown({ since } = {}) {
  const sinceIso =
    since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return queryMany(
    `SELECT
       CASE
         WHEN status_code < 200 THEN '1xx' WHEN status_code < 300 THEN '2xx'
         WHEN status_code < 400 THEN '3xx' WHEN status_code < 500 THEN '4xx'
         WHEN status_code < 600 THEN '5xx' ELSE 'unknown'
       END AS bucket,
       COUNT(*)::bigint AS count
     FROM request_logs WHERE created_at >= $1
     GROUP BY bucket ORDER BY bucket`,
    [sinceIso],
  );
}

async function p95Latency({ since } = {}) {
  const sinceIso = since || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const r = await queryOne(
    `SELECT COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::float AS p95
     FROM request_logs WHERE created_at >= $1 AND latency_ms IS NOT NULL`,
    [sinceIso],
  );
  return Number(r?.p95) || 0;
}

async function activeRequests() {
  const r = await queryOne(
    `SELECT COUNT(*)::int AS count FROM request_logs WHERE created_at >= NOW() - INTERVAL '5 seconds'`,
    [],
  );
  return r?.count || 0;
}

async function requestsPerSecond({ windowSec = 60 } = {}) {
  const r = await queryOne(
    `SELECT COUNT(*)::float / GREATEST($1, 1) AS rps
     FROM request_logs WHERE created_at >= NOW() - ($1 || ' seconds')::interval`,
    [windowSec],
  );
  return Number(r?.rps) || 0;
}

module.exports = {
  record,
  flush,
  overview,
  liveGraph,
  topRoutes,
  statusBreakdown,
  p95Latency,
  activeRequests,
  requestsPerSecond,
};
