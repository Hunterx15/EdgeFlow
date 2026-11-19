/**
 * EdgeFlow - Asynchronous Request Log Batcher
 *
 * Micro-batches log insertions to avoid running synchronous or unbuffered
 * individual SQL INSERTs on every proxied request.
 *
 * Flushes to PostgreSQL:
 *   - When batch size reaches BATCH_SIZE (50)
 *   - Or when timer reaches FLUSH_INTERVAL_MS (1000ms)
 *
 * Protects memory with bounded queue capacity under heavy burst loads.
 */

const { queryRaw } = require('../database/pool');
const logger = require('../utils/logger');

const BATCH_SIZE = 50;
const MAX_QUEUE_SIZE = 2000;
const FLUSH_INTERVAL_MS = 1000;

let queue = [];
let isFlushing = false;

let timer = null;
if (process.env.NODE_ENV !== 'test') {
  timer = setInterval(() => {
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

function enqueue(payload) {
  // Under extreme backpressure, evict oldest logs to safeguard process memory
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.splice(0, Math.floor(MAX_QUEUE_SIZE / 4));
  }
  queue.push(payload);
  if (queue.length >= BATCH_SIZE && !isFlushing) {
    flush().catch(() => {});
  }
}

async function flush() {
  if (queue.length === 0 || isFlushing) return;
  isFlushing = true;

  try {
    while (queue.length > 0) {
      const items = queue.splice(0, BATCH_SIZE * 2);
      if (items.length === 0) break;

      const valuePlaceholders = [];
      const values = [];
      let paramIndex = 1;

      for (const item of items) {
        const rowParams = [
          item.requestId,
          item.method,
          item.publicPath,
          item.serviceId,
          item.routeId,
          item.apiKeyId,
          item.upstreamUrl,
          item.statusCode,
          item.latencyMs,
          item.responseSize,
          item.error,
          item.clientIp,
          item.userAgent,
          item.cacheHit,
          item.retryCount,
          item.pipelineStages,
        ];

        const placeholders = rowParams.map((_, i) => `$${paramIndex + i}`);
        placeholders[15] = `${placeholders[15]}::jsonb`;
        valuePlaceholders.push(`(${placeholders.join(', ')})`);
        values.push(...rowParams);
        paramIndex += rowParams.length;
      }

      const sql = `
        INSERT INTO request_logs (
          request_id, method, public_path, service_id, route_id, api_key_id,
          upstream_url, status_code, latency_ms, response_size, error,
          client_ip, user_agent, cache_hit, retry_count, pipeline_stages
        ) VALUES ${valuePlaceholders.join(', ')}
      `;

      await queryRaw(sql, values);
    }
  } catch (err) {
    logger.warn('logBatcher: flush failed', { error: err.message });
  } finally {
    isFlushing = false;
  }
}

function size() {
  return queue.length;
}

module.exports = { enqueue, flush, size };
