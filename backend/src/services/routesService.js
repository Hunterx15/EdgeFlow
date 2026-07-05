/**
 * EdgeFlow - Routes service
 *
 * CRUD for dynamic routes. After mutations, invalidates route cache.
 */

const { queryOne, queryMany, queryRaw } = require('../database/pool');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/http');
const servicesService = require('./servicesService');

const COLS = `id, service_id, method, public_path, upstream_path, strip_prefix,
  auth_required, api_key_required, rate_limit_per_min, cache_ttl_sec,
  description, enabled, created_at, updated_at`;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', '*'];

async function getById(id) {
  const r = await queryOne(`SELECT ${COLS} FROM routes WHERE id = $1`, [id]);
  if (!r) throw new NotFoundError('Route');
  return r;
}

async function list({ limit = 100, offset = 0, serviceId = null } = {}) {
  if (serviceId) {
    return queryMany(`SELECT ${COLS} FROM routes WHERE service_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [serviceId, limit, offset]);
  }
  return queryMany(`SELECT ${COLS} FROM routes ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
}

async function create(input) {
  validateMethod(input.method);
  validatePaths(input.publicPath, input.upstreamPath);
  const svc = await servicesService.getById(input.serviceId);
  if (!svc) throw new NotFoundError('Service');
  const existing = await queryOne('SELECT id FROM routes WHERE method = $1 AND public_path = $2', [input.method.toUpperCase(), input.publicPath]);
  if (existing) throw new ConflictError(`Route ${input.method} ${input.publicPath} already exists`);
  const r = await queryOne(
    `INSERT INTO routes (service_id, method, public_path, upstream_path, strip_prefix,
       auth_required, api_key_required, rate_limit_per_min, cache_ttl_sec, description, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLS}`,
    [input.serviceId, input.method.toUpperCase(), input.publicPath, input.upstreamPath,
      input.stripPrefix, input.authRequired, input.apiKeyRequired, input.rateLimitPerMin,
      input.cacheTtlSec, input.description, input.enabled]
  );
  require('../gateway/routeCache').invalidate();
  return r;
}

async function update(id, patch) {
  const existing = await getById(id);
  if (patch.method) validateMethod(patch.method);
  if (patch.public_path) validatePaths(patch.public_path, existing.upstream_path);
  if (patch.upstream_path) validatePaths(existing.public_path, patch.upstream_path);
  if (patch.method) patch.method = patch.method.toUpperCase();

  const allowed = ['method', 'public_path', 'upstream_path', 'strip_prefix', 'auth_required',
    'api_key_required', 'rate_limit_per_min', 'cache_ttl_sec', 'description', 'enabled'];
  const sets = []; const values = []; let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    sets.push(`${k} = $${i++}`); values.push(patch[k]);
  }
  if (sets.length === 0) return existing;
  values.push(id);
  const updated = await queryOne(`UPDATE routes SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`, values);
  require('../gateway/routeCache').invalidate();
  return updated;
}

async function setEnabled(id, enabled) {
  const updated = await queryOne(`UPDATE routes SET enabled = $1 WHERE id = $2 RETURNING ${COLS}`, [enabled, id]);
  if (!updated) throw new NotFoundError('Route');
  require('../gateway/routeCache').invalidate();
  return updated;
}

async function remove(id) {
  await getById(id);
  await queryRaw('DELETE FROM routes WHERE id = $1', [id]);
  require('../gateway/routeCache').invalidate();
  return true;
}

async function findByPublicPath(method, publicPath) {
  const exact = await queryOne(`SELECT ${COLS} FROM routes WHERE method = $1 AND public_path = $2 AND enabled = TRUE`,
    [method.toUpperCase(), publicPath]);
  if (exact) return exact;
  // Wildcard match - longest prefix wins
  const all = await queryMany(`SELECT ${COLS} FROM routes WHERE enabled = TRUE AND (method = $1 OR method = '*')`,
    [method.toUpperCase()]);
  let best = null; let bestLen = -1;
  for (const r of all) {
    if (r.public_path.endsWith('/*') || r.public_path.endsWith(':*')) {
      const prefix = r.public_path.replace(/\/\*$/, '');
      if (publicPath.startsWith(prefix + '/') || publicPath === prefix) {
        if (prefix.length > bestLen) { best = r; bestLen = prefix.length; }
      }
    }
  }
  return best;
}

async function listAllEnabled() {
  return queryMany(`SELECT ${COLS} FROM routes WHERE enabled = TRUE`);
}

function validateMethod(method) {
  if (!method || !METHODS.includes(method.toUpperCase())) {
    throw new ValidationError(`HTTP method must be one of: ${METHODS.join(', ')}`);
  }
}
function validatePaths(publicPath, upstreamPath) {
  if (!publicPath || !publicPath.startsWith('/')) throw new ValidationError('publicPath must start with /');
  if (!upstreamPath || !upstreamPath.startsWith('/')) throw new ValidationError('upstreamPath must start with /');
}

module.exports = { getById, list, create, update, setEnabled, remove, findByPublicPath, listAllEnabled, METHODS };
