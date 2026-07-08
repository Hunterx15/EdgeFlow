/**
 * EdgeFlow - API key utilities
 *
 * Format: ef_live_<12-byte-keyId>.<32-byte-secret>
 * The keyId is safe to log; the secret is never stored - only its SHA-256.
 * Verification: split on '.', hash secret, look up by (key_id, key_hash).
 */

const crypto = require('crypto');
const PREFIX = 'ef';
const ENVS = ['live', 'test'];

function generateApiKey({ environment = 'live', name = 'unnamed' } = {}) {
  if (!ENVS.includes(environment)) throw new Error(`Invalid environment: ${environment}`);
  const keyIdSegment = crypto.randomBytes(12).toString('base64url');
  const secretSegment = crypto.randomBytes(32).toString('base64url');
  const keyId = `${PREFIX}_${environment}_${keyIdSegment}`;
  const fullKey = `${keyId}.${secretSegment}`;
  return { keyId, fullKey, keyHash: hashSecret(secretSegment), name, environment };
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function parseApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') throw new Error('Missing API key');
  const dot = rawKey.lastIndexOf('.');
  if (dot < 1 || dot === rawKey.length - 1) throw new Error('Malformed API key');
  const keyId = rawKey.slice(0, dot);
  const secret = rawKey.slice(dot + 1);
  if (!keyId.startsWith(`${PREFIX}_`)) throw new Error('Unknown API key prefix');
  return { keyId, secretHash: hashSecret(secret) };
}

module.exports = { generateApiKey, parseApiKey, hashSecret, PREFIX };
