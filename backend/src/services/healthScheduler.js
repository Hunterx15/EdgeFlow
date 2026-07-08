/**
 * EdgeFlow - Health-check scheduler
 *
 * Polls each enabled service's health_check_path on its configured
 * interval. Updates last_status + per-target healthy flag.
 *
 * ARCHITECTURE (dependency injection, no circular dependencies):
 *   Previously this module required servicesService (to load service
 *   data), but servicesService required healthScheduler (to schedule
 *   checks), creating a cycle. Now:
 *
 *   1. This module exposes setServiceProvider(fn) — the caller injects
 *      a function that loads service data. server.js wires this up at
 *      boot time:
 *        healthScheduler.setServiceProvider((id) => servicesService.getById(id));
 *        healthScheduler.setListProvider(() => servicesService.list({ enabledOnly: true }));
 *        healthScheduler.setHeartbeatUpdater((id, status, map) => servicesService.updateHeartbeat(id, status, map));
 *
 *   2. This module subscribes to eventBus for service CRUD events,
 *      so it auto-schedules/unschedules when services are created,
 *      updated, toggled, or deleted — without requiring servicesService.
 *
 *   3. servicesService emits events but does NOT require healthScheduler.
 *
 *   The dependency graph is now acyclic.
 */

const logger = require('../utils/logger');
const config = require('../config');
const eventBus = require('../utils/eventBus');
const http = require('http');
const https = require('https');

// Injected providers (set by server.js at boot time)
let serviceProvider = null;   // (id) => Promise<service>
let listProvider = null;      // () => Promise<service[]>
let heartbeatUpdater = null;  // (id, status, healthMap) => Promise<void>

function setServiceProvider(fn) { serviceProvider = fn; }
function setListProvider(fn) { listProvider = fn; }
function setHeartbeatUpdater(fn) { heartbeatUpdater = fn; }

const timers = new Map();
const failureStreaks = new Map();

function schedule(service) {
  if (!service || !service.enabled) return;
  unschedule(service.id);
  const intervalMs = service.health_check_interval_ms || config.gateway.healthCheck.intervalMs;
  const fn = async () => runCheck(service.id);
  fn().catch(() => {});
  const handle = setInterval(fn, intervalMs);
  handle.unref?.();
  timers.set(service.id, { interval: handle, fn });
}

function reschedule(service) { schedule(service); }

function unschedule(serviceId) {
  const t = timers.get(serviceId);
  if (t) { clearInterval(t.interval); timers.delete(serviceId); }
  failureStreaks.delete(serviceId);
}

async function runCheck(serviceId) {
  if (!serviceProvider) return;
  let service;
  try {
    service = await serviceProvider(serviceId);
    if (!service || !service.enabled) { unschedule(serviceId); return; }
  } catch (err) {
    logger.warn('health: runCheck failed to load service', { serviceId, error: err.message });
    return;
  }
  const targets = service.upstream_targets || [];
  if (targets.length === 0) return;

  // Validate health_check_path starts with / (prevent malformed URL)
  const healthPath = service.health_check_path || '/health';
  const path = healthPath.startsWith('/') ? healthPath : '/' + healthPath;

  const results = await Promise.all(
    targets.map(async (t) => ({ url: t.url, ok: await probe(t.url + path) }))
  );
  const healthMap = {};
  let allOk = true;
  for (const r of results) { healthMap[r.url] = r.ok; if (!r.ok) allOk = false; }
  const streak = failureStreaks.get(serviceId) || 0;
  failureStreaks.set(serviceId, allOk ? 0 : streak + 1);
  const currentStreak = failureStreaks.get(serviceId);
  let status = service.last_status;
  if (allOk) status = 'healthy';
  else if (currentStreak >= config.gateway.healthCheck.unhealthyThreshold) status = 'unhealthy';
  if (heartbeatUpdater) {
    await heartbeatUpdater(serviceId, status, healthMap).catch((err) => {
      logger.warn('health: heartbeat update failed', { serviceId, error: err.message });
    });
  }
}

function probe(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    // SECURITY: Don't follow redirects — a misconfigured health endpoint
    // that 302-redirects to an internal URL (e.g., 169.254.169.254)
    // would trigger SSRF. We only accept 2xx/3xx as healthy and don't
    // follow the redirect.
    const req = lib.get(url, {
      timeout: config.gateway.healthCheck.timeoutMs,
      headers: { 'User-Agent': 'EdgeFlow-HealthCheck/2.0' },
    }, (res) => {
      res.resume();
      // 2xx = healthy, 3xx = acceptable (redirects not followed)
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function reconcile() {
  if (!listProvider) return;
  const services = await listProvider();
  const liveIds = new Set(services.map((s) => s.id));
  for (const id of timers.keys()) if (!liveIds.has(id)) unschedule(id);
  for (const s of services) schedule(s);
  logger.info('health: scheduler reconciled', { scheduled: services.length });
}

function stopAll() { for (const id of timers.keys()) unschedule(id); }
function snapshot() { return Array.from(timers.keys()); }

// ── Subscribe to service events (auto-schedule/unschedule) ──
// This replaces the old pattern where servicesService called
// healthScheduler.schedule() directly. Now servicesService emits events,
// and we react here — no circular require.
eventBus.on(eventBus.EVENTS.SERVICE_CREATED, (svc) => schedule(svc));
eventBus.on(eventBus.EVENTS.SERVICE_UPDATED, (svc) => reschedule(svc));
eventBus.on(eventBus.EVENTS.SERVICE_TOGGLED, (svc) => {
  if (!svc.enabled) unschedule(svc.id);
  else reschedule(svc);
});
eventBus.on(eventBus.EVENTS.SERVICE_DELETED, ({ id }) => unschedule(id));

module.exports = {
  schedule, reschedule, unschedule, reconcile, stopAll, snapshot, runCheck,
  setServiceProvider, setListProvider, setHeartbeatUpdater,
};
