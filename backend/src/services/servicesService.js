/**
 * EdgeFlow - Services service
 *
 * CRUD for backend services. Talks to PostgreSQL directly. After any
 * mutation we invalidate the in-memory route cache and reschedule the
 * health-check scheduler.
 */

const { queryOne, queryMany, queryRaw } = require('../database/pool');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/http');
const { normalizeUpstreamTargets } = require('../utils/upstream');
const routeCache = require('../gateway/routeCache');
const healthScheduler = require('./healthScheduler');

const COLS = `id, name, slug, description, base_path, upstream_targets, version,
  enabled, health_check_path, health_check_interval_ms, last_heartbeat_at,
  last_status, metadata, created_at, updated_at`;

async function getById(id) {
  const svc = await queryOne(`SELECT ${COLS} FROM services WHERE id = $1`, [id]);
  if (!svc) throw new NotFoundError('Service');
  return svc;
}

async function list({ limit = 100, offset = 0, enabledOnly = false } = {}) {
  const where = enabledOnly ? 'WHERE enabled = TRUE' : '';
  return queryMany(`SELECT ${COLS} FROM services ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
}

async function stats() {
  return queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE last_status = 'healthy')   AS healthy,
      COUNT(*) FILTER (WHERE last_status = 'unhealthy') AS unhealthy,
      COUNT(*) FILTER (WHERE last_status IS NULL OR last_status = 'unknown') AS unknown,
      COUNT(*) AS total
    FROM services WHERE enabled = TRUE
  `) || { healthy: 0, unhealthy: 0, unknown: 0, total: 0 };
}

async function create(input) {
  const slug = (input.slug || slugify(input.name)).toLowerCase();
  if (await queryOne('SELECT id FROM services WHERE slug = $1', [slug])) {
    throw new ConflictError(`Service slug '${slug}' already exists`);
  }
  if (await queryOne('SELECT id FROM services WHERE base_path = $1', [input.basePath])) {
    throw new ConflictError(`Base path '${input.basePath}' already in use`);
  }
  const upstreamTargets = normalizeUpstreamTargets(input.upstreamTargets);
  const svc = await queryOne(
    `INSERT INTO services (name, slug, description, base_path, upstream_targets, version,
       enabled, health_check_path, health_check_interval_ms, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLS}`,
    [input.name, slug, input.description || null, input.basePath, JSON.stringify(upstreamTargets),
      input.version || 'v1', input.enabled !== false, input.healthCheckPath || '/health',
      input.healthCheckIntervalMs || 30000, JSON.stringify(input.metadata || {})]
  );
  healthScheduler.schedule(svc);
  return svc;
}

async function update(id, patch) {
  const existing = await getById(id);
  if (patch.slug && patch.slug !== existing.slug) {
    if (await queryOne('SELECT id FROM services WHERE slug = $1', [patch.slug])) {
      throw new ConflictError(`Service slug '${patch.slug}' already exists`);
    }
  }
  if (patch.base_path && patch.base_path !== existing.base_path) {
    if (await queryOne('SELECT id FROM services WHERE base_path = $1', [patch.base_path])) {
      throw new ConflictError(`Base path '${patch.base_path}' already in use`);
    }
  }
  if (patch.upstream_targets) patch.upstream_targets = normalizeUpstreamTargets(patch.upstream_targets);
  if (patch.upstreamTargets) { patch.upstream_targets = normalizeUpstreamTargets(patch.upstreamTargets); delete patch.upstreamTargets; }

  const allowed = ['name', 'slug', 'description', 'base_path', 'upstream_targets', 'version',
    'enabled', 'health_check_path', 'health_check_interval_ms', 'metadata'];
  const sets = []; const values = []; let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'upstream_targets' || k === 'metadata') v = JSON.stringify(v);
    sets.push(`${k} = $${i++}`); values.push(v);
  }
  if (sets.length === 0) return existing;
  values.push(id);
  const updated = await queryOne(`UPDATE services SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`, values);
  routeCache.invalidate();
  healthScheduler.reschedule(updated);
  return updated;
}

async function setEnabled(id, enabled) {
  const updated = await queryOne(`UPDATE services SET enabled = $1 WHERE id = $2 RETURNING ${COLS}`, [enabled, id]);
  if (!updated) throw new NotFoundError('Service');
  routeCache.invalidate();
  if (!enabled) healthScheduler.unschedule(id);
  else healthScheduler.reschedule(updated);
  return updated;
}

async function updateHeartbeat(id, status, targetHealthMap = null) {
  if (targetHealthMap) {
    const svc = await getById(id);
    if (svc) {
      const updated = svc.upstream_targets.map((t) => ({ ...t, healthy: targetHealthMap[t.url] ?? t.healthy }));
      return queryOne(`UPDATE services SET last_heartbeat_at = NOW(), last_status = $1, upstream_targets = $2 WHERE id = $3 RETURNING ${COLS}`,
        [status, JSON.stringify(updated), id]);
    }
  }
  return queryOne(`UPDATE services SET last_heartbeat_at = NOW(), last_status = $1 WHERE id = $2 RETURNING ${COLS}`, [status, id]);
}

async function remove(id) {
  await getById(id);
  healthScheduler.unschedule(id);
  await queryRaw('DELETE FROM services WHERE id = $1', [id]);
  routeCache.invalidate();
  return true;
}

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `svc-${Date.now()}`;
}

module.exports = { getById, list, stats, create, update, setEnabled, updateHeartbeat, remove, slugify };
