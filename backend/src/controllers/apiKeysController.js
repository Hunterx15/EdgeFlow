/**
 * EdgeFlow - API keys controller
 */

const apiKeysService = require('../services/apiKeysService');
const { ok, paginate } = require('../utils/http');
const { parsePagination, parseBoolean } = require('../utils/controllerHelpers');

async function list(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req.query);
    const items = await apiKeysService.list({ limit, offset });
    // Fetch total count separately — items.length is just the page size.
    const total = await apiKeysService.count();
    return ok(res, items, paginate({ page, limit, total }));
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try { return ok(res, await apiKeysService.getById(req.params.id)); }
  catch (err) { next(err); }
}

async function issue(req, res, next) {
  try {
    const k = await apiKeysService.issue(req.body);
    return ok(res, k, { warning: 'Save the plaintextKey now - it cannot be retrieved later.' }, 201);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try { return ok(res, await apiKeysService.update(req.params.id, req.body)); }
  catch (err) { next(err); }
}

async function setEnabled(req, res, next) {
  try { return ok(res, await apiKeysService.setEnabled(req.params.id, parseBoolean(req.body?.enabled, false))); }
  catch (err) { next(err); }
}

async function revoke(req, res, next) {
  try { await apiKeysService.revoke(req.params.id); return ok(res, { revoked: true }); }
  catch (err) { next(err); }
}

module.exports = { list, getById, issue, update, setEnabled, revoke };
