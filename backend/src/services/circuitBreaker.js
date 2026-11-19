/**
 * EdgeFlow - Circuit Breaker
 *
 * Per-upstream-URL state machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED.
 * State is held in memory for hot-path reads and mirrored to PostgreSQL
 * so it survives restarts and is shared across replicas.
 *
 * CLOSED:    requests flow. Failures increment failure_count.
 *            When failure_count >= threshold -> OPEN.
 * OPEN:      requests fail fast with 503. After openStateMs -> HALF_OPEN.
 * HALF_OPEN: allow up to halfOpenMaxCalls probe requests.
 *            success_count >= successThreshold -> CLOSED.
 *            Any failure -> OPEN again.
 */

const { queryOne, queryRaw, queryMany } = require('../database/pool');
const redis = require('../database/redis');
const config = require('../config');
const logger = require('../utils/logger');
const eventBus = require('../utils/eventBus');

const cfg = { failureThreshold: 5, successThreshold: 2, openStateMs: 30000, halfOpenMaxCalls: 3 };
const state = new Map();

// Clean up circuit breaker state when a service is deleted — prevents
// memory leak where deleted upstreams' breaker state persists forever.
// The event payload includes the service's upstream_targets so we can
// match breaker entries by URL.
eventBus.on(eventBus.EVENTS.SERVICE_DELETED, ({ upstreamTargets }) => {
  if (!Array.isArray(upstreamTargets)) return;
  for (const t of upstreamTargets) {
    if (t.url && state.has(t.url)) {
      state.delete(t.url);
      logger.debug('circuit: cleaned up state for deleted upstream', { upstreamUrl: t.url });
    }
  }
});

function get(upstreamUrl) {
  if (!state.has(upstreamUrl)) {
    state.set(upstreamUrl, {
      state: 'closed', failureCount: 0, successCount: 0, openedAt: 0,
      lastTransitionAt: 0, halfOpenInflight: 0,
    });
  }
  return state.get(upstreamUrl);
}

function nowMs() { return Date.now(); }

function allowRequest(upstreamUrl) {
  const s = get(upstreamUrl);
  if (s.state === 'open') {
    const elapsed = nowMs() - s.openedAt;
    if (elapsed >= cfg.openStateMs) {
      s.state = 'half_open'; s.successCount = 0; s.failureCount = 0;
      s.halfOpenInflight = 0; s.lastTransitionAt = nowMs();
      logger.info('circuit: OPEN -> HALF_OPEN', { upstreamUrl });
      persistAsync(upstreamUrl, s);
    } else {
      return { allowed: false, state: 'open', retryAfterMs: cfg.openStateMs - elapsed };
    }
  }
  if (s.state === 'half_open' && s.halfOpenInflight >= cfg.halfOpenMaxCalls) {
    return { allowed: false, state: 'half_open', retryAfterMs: 1000 };
  }
  if (s.state === 'half_open') s.halfOpenInflight += 1;
  return { allowed: true, state: s.state };
}

function recordSuccess(upstreamUrl) {
  const s = get(upstreamUrl);
  if (s.state === 'half_open') {
    s.successCount += 1;
    s.halfOpenInflight = Math.max(0, s.halfOpenInflight - 1);
    if (s.successCount >= cfg.successThreshold) {
      s.state = 'closed'; s.failureCount = 0; s.successCount = 0;
      s.lastTransitionAt = nowMs();
      logger.info('circuit: HALF_OPEN -> CLOSED', { upstreamUrl });
      persistAsync(upstreamUrl, s);
    }
  } else if (s.state === 'closed') {
    s.failureCount = 0;
  }
}

function recordFailure(upstreamUrl) {
  const s = get(upstreamUrl);
  if (s.state === 'half_open') {
    s.state = 'open'; s.openedAt = nowMs(); s.lastTransitionAt = nowMs();
    s.halfOpenInflight = 0;
    logger.warn('circuit: HALF_OPEN -> OPEN (failure)', { upstreamUrl });
    persistAsync(upstreamUrl, s);
    return;
  }
  if (s.state === 'closed') {
    s.failureCount += 1;
    if (s.failureCount >= cfg.failureThreshold) {
      s.state = 'open'; s.openedAt = nowMs(); s.lastTransitionAt = nowMs();
      logger.warn('circuit: CLOSED -> OPEN', { upstreamUrl, failures: s.failureCount });
      persistAsync(upstreamUrl, s);
    }
  }
}

async function persistAsync(upstreamUrl, s) {
  try {
    await queryRaw(
      `INSERT INTO circuit_breaker_state (upstream_url, state, failure_count, success_count, opened_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (upstream_url) DO UPDATE SET
         state = EXCLUDED.state, failure_count = EXCLUDED.failure_count,
         success_count = EXCLUDED.success_count, opened_at = EXCLUDED.opened_at,
         updated_at = NOW()`,
      [upstreamUrl, s.state, s.failureCount, s.successCount, s.state === 'open' ? new Date(s.openedAt).toISOString() : null]
    );
  } catch (err) { logger.warn('circuit: persist failed', { error: err.message, upstreamUrl }); }

  // Broadcast state change across replicas via Redis Pub/Sub
  try {
    const c = await redis.getClient();
    if (typeof c.publish === 'function') {
      await c.publish('ef:circuit:events', JSON.stringify({
        upstreamUrl,
        state: s.state,
        openedAt: s.openedAt,
        failureCount: s.failureCount,
        successCount: s.successCount,
      }));
    }
  } catch (_) {}
}

let subClient = null;

async function initSubscriber() {
  if (!config.redis.enabled) return;
  try {
    const { createClient } = require('redis');
    subClient = createClient({
      url: config.redis.url,
      socket: { reconnectStrategy: (r) => r > 10 ? new Error('REDIS_MAX_RETRIES') : Math.min(r * 200, 2000) },
    });
    subClient.on('error', () => {});
    await subClient.connect();
    await subClient.subscribe('ef:circuit:events', (message) => {
      try {
        const event = JSON.parse(message);
        if (!event.upstreamUrl || !event.state) return;
        const current = get(event.upstreamUrl);
        current.state = event.state;
        if (event.state === 'open') {
          current.openedAt = event.openedAt || Date.now();
          current.halfOpenInflight = 0;
        } else if (event.state === 'closed') {
          current.failureCount = 0;
          current.successCount = 0;
        }
        logger.debug('circuit: synced remote state transition', { upstreamUrl: event.upstreamUrl, state: event.state });
      } catch (_) {}
    });
    logger.info('circuit: subscribed to distributed state events');
  } catch (err) {
    logger.debug('circuit: pub/sub not initialized (running standalone breaker)', { error: err.message });
  }
}

async function close() {
  if (subClient && subClient.isOpen) {
    try { await subClient.quit(); } catch (_) {}
    subClient = null;
  }
}

async function loadPersistedState() {
  try {
    const rows = await queryMany('SELECT * FROM circuit_breaker_state', []);
    for (const row of rows) {
      state.set(row.upstream_url, {
        state: row.state, failureCount: row.failure_count, successCount: row.success_count,
        openedAt: row.opened_at ? new Date(row.opened_at).getTime() : 0,
        lastTransitionAt: new Date(row.updated_at).getTime(), halfOpenInflight: 0,
      });
    }
    logger.info('circuit: loaded persisted state', { count: rows.length });
  } catch (err) { logger.warn('circuit: failed to load persisted state', { error: err.message }); }
}

function reset(upstreamUrl) {
  const s = get(upstreamUrl);
  s.state = 'closed';
  s.failureCount = 0;
  s.successCount = 0;
  s.openedAt = 0;
  s.halfOpenInflight = 0;
  s.lastTransitionAt = nowMs();
  persistAsync(upstreamUrl, s);
  return s;
}

function configure(opts) { Object.assign(cfg, opts); }
function getState(upstreamUrl) { return get(upstreamUrl); }
function listAll() { return Array.from(state.entries()).map(([url, s]) => ({ upstreamUrl: url, ...s })); }

module.exports = {
  allowRequest,
  recordSuccess,
  recordFailure,
  reset,
  loadPersistedState,
  initSubscriber,
  close,
  configure,
  getState,
  listAll,
};
