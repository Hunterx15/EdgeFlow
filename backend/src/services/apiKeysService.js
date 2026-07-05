/**
 * EdgeFlow - API keys service
 *
 * Issue / list / revoke API keys. Plaintext key shown ONCE on creation.
 */

const { queryOne, queryMany, queryRaw } = require('../database/pool');
const { generateApiKey, parseApiKey } = require('../utils/apiKey');
const { NotFoundError, ValidationError } = require('../utils/http');

const COLS = `id, key_id, key_hash, name, scopes, rate_limit_per_min, enabled,
  expires_at, last_used_at, total_requests, created_at, updated_at`;

async function getById(id) {
  const k = await queryOne(`SELECT ${COLS} FROM api_keys WHERE id = $1`, [id]);
  if (!k) throw new NotFoundError('API key');
  return k;
}

async function list({ limit = 100, offset = 0 } = {}) {
  return queryMany(`SELECT ${COLS} FROM api_keys ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
}

async function issue({ name, scopes = [], rateLimitPerMin = 100, expiresInDays = null, environment = 'live' }) {
  if (!name) throw new ValidationError('API key name is required');
  if (rateLimitPerMin < 1 || rateLimitPerMin > 100000) throw new ValidationError('rateLimitPerMin must be between 1 and 100000');
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
  const generated = generateApiKey({ environment, name });
  const stored = await queryOne(
    `INSERT INTO api_keys (key_id, key_hash, name, scopes, rate_limit_per_min, enabled, expires_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING ${COLS}`,
    [generated.keyId, generated.keyHash, name, JSON.stringify(scopes), rateLimitPerMin, expiresAt]
  );
  return { ...stored, plaintextKey: generated.fullKey };
}

async function update(id, patch) {
  await getById(id);
  const allowed = ['name', 'scopes', 'rate_limit_per_min', 'enabled', 'expires_at'];
  const sets = []; const values = []; let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'scopes') v = JSON.stringify(v);
    sets.push(`${k} = $${i++}`); values.push(v);
  }
  if (sets.length === 0) return getById(id);
  values.push(id);
  return queryOne(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`, values);
}

async function setEnabled(id, enabled) {
  const updated = await queryOne(`UPDATE api_keys SET enabled = $1 WHERE id = $2 RETURNING ${COLS}`, [enabled, id]);
  if (!updated) throw new NotFoundError('API key');
  return updated;
}

async function revoke(id) {
  await getById(id);
  await queryRaw('DELETE FROM api_keys WHERE id = $1', [id]);
  return true;
}

async function validate(rawKey) {
  let parsed;
  try { parsed = parseApiKey(rawKey); }
  catch (err) { return { valid: false, reason: err.message }; }
  const key = await queryOne(`SELECT ${COLS} FROM api_keys WHERE key_id = $1 AND key_hash = $2 AND enabled = TRUE`,
    [parsed.keyId, parsed.secretHash]);
  if (!key) return { valid: false, reason: 'Invalid API key' };
  if (key.expires_at && new Date(key.expires_at) < new Date()) return { valid: false, reason: 'API key expired' };
  queryRaw('UPDATE api_keys SET last_used_at = NOW(), total_requests = total_requests + 1 WHERE id = $1', [key.id]).catch(() => {});
  return { valid: true, apiKey: key };
}

module.exports = { getById, list, issue, update, setEnabled, revoke, validate };
