/**
 * EdgeFlow - Routes controller
 */

const routesService = require('../services/routesService');
const { ok, paginate } = require('../utils/http');

async function list(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const serviceId = req.query.serviceId || undefined;
    const items = await routesService.list({ limit, offset, serviceId });
    return ok(res, items, paginate({ page: Math.floor(offset / limit) + 1, limit, total: items.length }));
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try { return ok(res, await routesService.getById(req.params.id)); }
  catch (err) { next(err); }
}

async function create(req, res, next) {
  try { return ok(res, await routesService.create(req.body), {}, 201); }
  catch (err) { next(err); }
}

async function update(req, res, next) {
  try { return ok(res, await routesService.update(req.params.id, req.body)); }
  catch (err) { next(err); }
}

async function setEnabled(req, res, next) {
  try { return ok(res, await routesService.setEnabled(req.params.id, req.body.enabled === true)); }
  catch (err) { next(err); }
}

async function remove(req, res, next) {
  try { await routesService.remove(req.params.id); return ok(res, { deleted: true }); }
  catch (err) { next(err); }
}

module.exports = { list, getById, create, update, setEnabled, remove };
