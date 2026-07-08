/**
 * EdgeFlow - Event Bus
 *
 * A tiny in-process pub/sub event bus used to break circular dependencies
 * between modules that need to react to each other's mutations.
 *
 * ARCHITECTURE:
 *   Before (circular):
 *     routesService ──require──> routeCache (to invalidate)
 *     routeCache    ──require──> routesService (to listAllEnabled)
 *     servicesService ──require──> healthScheduler (to schedule)
 *     healthScheduler ──require──> servicesService (to load services)
 *
 *   After (event-driven, no cycles):
 *     routesService ──emit('route.changed')──> eventBus ──on──> routeCache
 *     routeCache    ──require──> routesService (one direction only — OK)
 *     servicesService ──emit('service.changed')──> eventBus ──on──> healthScheduler
 *     healthScheduler ──emit('health.checked')──> eventBus ──on──> servicesService
 *
 * The event bus is synchronous (listeners run in the same tick). This is
 * intentional — cache invalidation must happen before the next request
 * sees stale data.
 *
 * For multi-process scenarios, this would need to be backed by Redis
 * Pub/Sub. For a single-replica gateway, in-process is sufficient.
 */

const logger = require('../utils/logger');

const listeners = new Map();

function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  // Return an unsubscribe function
  return () => off(event, handler);
}

function off(event, handler) {
  const set = listeners.get(event);
  if (set) set.delete(handler);
}

function emit(event, ...args) {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;
  for (const handler of set) {
    try {
      handler(...args);
    } catch (err) {
      logger.error('eventBus: handler error', { event, error: err.message });
    }
  }
}

function clear() {
  listeners.clear();
}

// Standard event names (documented as the public API)
const EVENTS = {
  ROUTE_CREATED: 'route.created',
  ROUTE_UPDATED: 'route.updated',
  ROUTE_DELETED: 'route.deleted',
  ROUTE_TOGGLED: 'route.toggled',
  SERVICE_CREATED: 'service.created',
  SERVICE_UPDATED: 'service.updated',
  SERVICE_DELETED: 'service.deleted',
  SERVICE_TOGGLED: 'service.toggled',
  HEALTH_CHECKED: 'health.checked',
};

module.exports = { on, off, emit, clear, EVENTS };
