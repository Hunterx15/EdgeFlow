/**
 * EdgeFlow - Health-check scheduler
 *
 * Polls each enabled service's health_check_path on its configured
 * interval. Updates last_status + per-target healthy flag. Per-service
 * setInterval so each service can have its own cadence.
 */
const logger = require('../utils/logger');
const config = require('../config');
const http = require('http');
const https = require('https');

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
  const servicesService = require('./servicesService');
  let service;
  try {
    service = await servicesService.getById(serviceId);
    if (!service || !service.enabled) { unschedule(serviceId); return; }
  } catch (err) { return; }
  const targets = service.upstream_targets || [];
  if (targets.length === 0) return;

  const results = await Promise.all(
    targets.map(async (t) => ({ url: t.url, ok: await probe(t.url + service.health_check_path) }))
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
  await servicesService.updateHeartbeat(serviceId, status, healthMap).catch(() => {});
}

function probe(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: config.gateway.healthCheck.timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function reconcile() {
  const servicesService = require('./servicesService');
  const services = await servicesService.list({ enabledOnly: true });
  const liveIds = new Set(services.map((s) => s.id));
  for (const id of timers.keys()) if (!liveIds.has(id)) unschedule(id);
  for (const s of services) schedule(s);
  logger.info('health: scheduler reconciled', { scheduled: services.length });
}

function stopAll() { for (const id of timers.keys()) unschedule(id); }
function snapshot() { return Array.from(timers.keys()); }

module.exports = { schedule, reschedule, unschedule, reconcile, stopAll, snapshot, runCheck };
