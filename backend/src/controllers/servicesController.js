/**
 * EdgeFlow - Services controller
 */

const servicesService = require('../services/servicesService');
const { ok, paginate } = require('../utils/http');

async function list(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const enabledOnly = req.query.enabled === 'true';
    const items = await servicesService.list({ limit, offset, enabledOnly });
    return ok(res, items, paginate({ page: Math.floor(offset / limit) + 1, limit, total: items.length }));
  } catch (err) { next(err); }
}

async function stats(req, res, next) {
  try { return ok(res, await servicesService.stats()); }
  catch (err) { next(err); }
}

async function getById(req, res, next) {
  try { return ok(res, await servicesService.getById(req.params.id)); }
  catch (err) { next(err); }
}

async function create(req, res, next) {
  try { return ok(res, await servicesService.create(req.body), {}, 201); }
  catch (err) { next(err); }
}

async function update(req, res, next) {
  try { return ok(res, await servicesService.update(req.params.id, req.body)); }
  catch (err) { next(err); }
}

async function setEnabled(req, res, next) {
  try { return ok(res, await servicesService.setEnabled(req.params.id, req.body.enabled === true)); }
  catch (err) { next(err); }
}

async function remove(req, res, next) {
  try { await servicesService.remove(req.params.id); return ok(res, { deleted: true }); }
  catch (err) { next(err); }
}

async function checkHealth(req, res, next) {
  try {
    const healthScheduler = require('../services/healthScheduler');
    await healthScheduler.runCheck(req.params.id);
    const svc = await servicesService.getById(req.params.id);
    return ok(res, {
      serviceId: svc.id, lastStatus: svc.last_status,
      lastHeartbeatAt: svc.last_heartbeat_at, upstreamTargets: svc.upstream_targets,
    });
  } catch (err) { next(err); }
}

module.exports = { list, stats, getById, create, update, setEnabled, remove, checkHealth };
