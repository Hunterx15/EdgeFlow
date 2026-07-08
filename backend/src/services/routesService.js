/**
 * EdgeFlow - Routes service
 *
 * CRUD for dynamic routes. After mutations, invalidates route cache.
 *
 * ARCHITECTURAL INVARIANT (enforced by normalizePublicPath):
 *   Routes are stored in the database WITHOUT the gateway prefix.
 *   The gateway prefix (e.g. "/gateway") is a mount-point concern —
 *   it's where Express mounts the proxy via app.use(gatewayPrefix, proxyMiddleware).
 *   The public_path column represents the logical path WITHIN the gateway's
 *   route space. The proxy strips the gateway prefix from the incoming URL
 *   BEFORE looking up the route, so the lookup key never contains the prefix.
 *
 *   This means:
 *     - A request to /gateway/xcode/health becomes a lookup for /xcode/health
 *     - The route's public_path must be /xcode/health (NOT /gateway/xcode/health)
 *
 *   normalizePublicPath() enforces this invariant on every create and update,
 *   so even if the user types /gateway/xcode/health in the dashboard, the
 *   service stores /xcode/health. This keeps the DB data consistent with the
 *   proxy's lookup logic regardless of what the client sends.
 */

const { queryOne, queryMany, queryRaw } = require('../database/pool');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/http');
const eventBus = require('../utils/eventBus');
const config = require('../config');

const COLS = `id, service_id, method, public_path, upstream_path, strip_prefix,
  auth_required, api_key_required, rate_limit_per_min, cache_ttl_sec,
  description, enabled, created_at, updated_at`;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', '*'];

/**
 * Strip the gateway prefix from a public path if present.
 *
 * Users frequently type "/gateway/xcode/health" in the dashboard because the
 * gateway prefix is part of the URL they see in the browser. But the proxy
 * strips the prefix before lookup, so the stored public_path must NOT include
 * it. This function normalizes the input so the DB always stores the
 * prefix-free form.
 *
 * Examples (gatewayPrefix = "/gateway"):
 *   "/gateway/xcode/health"  → "/xcode/health"
 *   "/gateway/xcode/*"       → "/xcode/*"
 *   "/xcode/health"          → "/xcode/health"  (no change)
 *   "/"                      → "/"              (no change)
 */
function normalizePublicPath(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return publicPath;
  const prefix = config.server.gatewayPrefix;
  let normalized = publicPath;
  if (prefix && normalized.startsWith(prefix)) {
    normalized = normalized.slice(prefix.length);
  }
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  return normalized;
}

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
  // Normalize the public path BEFORE validation and storage so the
  // gateway prefix is never persisted.
  input.publicPath = normalizePublicPath(input.publicPath);
  validatePaths(input.publicPath, input.upstreamPath);
  // Verify the service exists. We do a direct DB query instead of calling
  // servicesService.getById() to avoid a service-to-service dependency
  // (which would create a circular dependency via the event bus).
  const svc = await queryOne('SELECT id, enabled FROM services WHERE id = $1', [input.serviceId]);
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
  // Emit event instead of directly requiring routeCache (breaks cycle).
  // routeCache subscribes to this event and calls invalidate().
  eventBus.emit(eventBus.EVENTS.ROUTE_CREATED, r);
  return r;
}

async function update(id, patch) {
  const existing = await getById(id);
  if (patch.method) validateMethod(patch.method);
  // Normalize the public path if it's being updated — same invariant as create.
  if (patch.public_path) {
    patch.public_path = normalizePublicPath(patch.public_path);
    validatePaths(patch.public_path, existing.upstream_path);
  }
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
  eventBus.emit(eventBus.EVENTS.ROUTE_UPDATED, updated);
  return updated;
}

async function setEnabled(id, enabled) {
  const updated = await queryOne(`UPDATE routes SET enabled = $1 WHERE id = $2 RETURNING ${COLS}`, [enabled, id]);
  if (!updated) throw new NotFoundError('Route');
  eventBus.emit(eventBus.EVENTS.ROUTE_TOGGLED, updated);
  return updated;
}

async function remove(id) {
  await getById(id);
  await queryRaw('DELETE FROM routes WHERE id = $1', [id]);
  eventBus.emit(eventBus.EVENTS.ROUTE_DELETED, { id });
  return true;
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

module.exports = { getById, list, create, update, setEnabled, remove, listAllEnabled, normalizePublicPath, METHODS };
