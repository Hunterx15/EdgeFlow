/**
 * EdgeFlow - Weighted Round Robin Load Balancer
 *
 * Smooth weighted round-robin (the same algorithm nginx uses). Each
 * target has a `weight` (configured) and a `currentWeight` (mutable).
 * On each call:
 *   1. Add weight to currentWeight for every target
 *   2. Pick the target with the highest currentWeight
 *   3. Subtract total weight from the picked target's currentWeight
 *
 * Unhealthy targets are filtered out before selection.
 */

const { healthyTargetsOnly } = require('../utils/upstream');
const eventBus = require('../utils/eventBus');

const counters = new Map(); // serviceId -> { counter, currentWeights }

// Clean up counters when a service is deleted — prevents memory leak
// where deleted services' counter state persists forever.
eventBus.on(eventBus.EVENTS.SERVICE_DELETED, ({ id }) => reset(id));

function nextTarget(service) {
  if (!service || !Array.isArray(service.upstream_targets)) return null;
  const healthy = healthyTargetsOnly(service.upstream_targets);
  if (healthy.length === 0) return null;
  if (healthy.length === 1) return healthy[0];
  if (healthy.some((t) => t.weight && t.weight > 1)) return weightedRoundRobin(service.id, healthy);
  return simpleRoundRobin(service.id, healthy);
}

function simpleRoundRobin(serviceId, targets) {
  const state = counters.get(serviceId) || { counter: 0 };
  const target = targets[state.counter % targets.length];
  state.counter = (state.counter + 1) % targets.length;
  counters.set(serviceId, state);
  return target;
}

function weightedRoundRobin(serviceId, targets) {
  let state = counters.get(serviceId);
  if (!state || !state.currentWeights) {
    state = { counter: 0, currentWeights: new Map() };
    counters.set(serviceId, state);
  }
  const cw = state.currentWeights;
  let total = 0;
  for (const t of targets) {
    const w = t.weight || 1;
    cw.set(t.url, (cw.get(t.url) || 0) + w);
    total += w;
  }
  let best = null; let bestWeight = -Infinity;
  for (const t of targets) {
    const w = cw.get(t.url) || 0;
    if (w > bestWeight) { bestWeight = w; best = t; }
  }
  if (best) cw.set(best.url, bestWeight - total);
  return best;
}

function reset(serviceId) { counters.delete(serviceId); }
function snapshot() {
  const out = {};
  for (const [id, s] of counters) out[id] = { counter: s.counter };
  return out;
}

module.exports = { nextTarget, reset, snapshot };
