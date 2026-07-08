/**
 * EdgeFlow - Validation schemas
 */

const {
  isString, isOptionalString, isOptionalBoolean,
  isOptionalInt, ensureRequired,
} = require('../middlewares/validate');
const { ValidationError } = require('../utils/http');

const loginSchema = (b) => {
  const email = ensureRequired(b.email, 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('A valid email is required');
  const password = ensureRequired(b.password, 'password');
  if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
  return { email: email.toLowerCase().trim(), password };
};

const createUserSchema = (b) => {
  const email = ensureRequired(b.email, 'email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('A valid email is required');
  const name = ensureRequired(b.name, 'name');
  if (!isString(name, { max: 120 })) throw new ValidationError('name must be 1-120 chars');
  const password = ensureRequired(b.password, 'password');
  if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
  return { email: email.toLowerCase().trim(), name, password, role: b.role || 'admin' };
};

const serviceCreateSchema = (b) => {
  const name = ensureRequired(b.name, 'name');
  if (!isString(name, { max: 120 })) throw new ValidationError('name must be 1-120 chars');
  if (b.slug !== undefined && !isOptionalString(b.slug, { max: 120 })) throw new ValidationError('slug must be 1-120 chars');
  const basePath = ensureRequired(b.basePath, 'basePath');
  if (!isString(basePath, { max: 255 }) || !basePath.startsWith('/')) throw new ValidationError('basePath must start with /');
  if (!Array.isArray(b.upstreamTargets) || b.upstreamTargets.length === 0) throw new ValidationError('upstreamTargets must be a non-empty array');
  return {
    name: name.trim(), slug: b.slug, description: b.description, basePath,
    upstreamTargets: b.upstreamTargets, version: b.version || 'v1',
    enabled: b.enabled !== undefined ? b.enabled : true,
    healthCheckPath: b.healthCheckPath || '/health',
    healthCheckIntervalMs: b.healthCheckIntervalMs || 30000,
    metadata: b.metadata,
  };
};

const serviceUpdateSchema = (b) => {
  const out = {};
  if (b.name !== undefined) { if (!isString(b.name, { max: 120 })) throw new ValidationError('name must be 1-120 chars'); out.name = b.name.trim(); }
  if (b.slug !== undefined) out.slug = b.slug;
  if (b.description !== undefined) out.description = b.description;
  if (b.basePath !== undefined) {
    if (!isString(b.basePath, { max: 255 }) || !b.basePath.startsWith('/')) throw new ValidationError('basePath must start with /');
    out.base_path = b.basePath;
  }
  if (b.upstreamTargets !== undefined) {
    if (!Array.isArray(b.upstreamTargets) || b.upstreamTargets.length === 0) throw new ValidationError('upstreamTargets must be a non-empty array');
    out.upstream_targets = b.upstreamTargets;
  }
  if (b.version !== undefined) out.version = b.version;
  if (b.enabled !== undefined) out.enabled = b.enabled;
  if (b.healthCheckPath !== undefined) out.health_check_path = b.healthCheckPath;
  if (b.healthCheckIntervalMs !== undefined) out.health_check_interval_ms = b.healthCheckIntervalMs;
  if (b.metadata !== undefined) out.metadata = b.metadata;
  return out;
};

const routeCreateSchema = (b) => {
  const serviceId = ensureRequired(b.serviceId, 'serviceId');
  const method = ensureRequired(b.method, 'method');
  if (!isString(method, { max: 10 })) throw new ValidationError('method must be 1-10 chars');
  const publicPath = ensureRequired(b.publicPath, 'publicPath');
  if (!isString(publicPath, { max: 255 }) || !publicPath.startsWith('/')) throw new ValidationError('publicPath must start with /');
  return {
    serviceId, method: method.toUpperCase(), publicPath,
    upstreamPath: b.upstreamPath || '/', stripPrefix: b.stripPrefix !== undefined ? b.stripPrefix : true,
    authRequired: b.authRequired !== undefined ? b.authRequired : true,
    apiKeyRequired: b.apiKeyRequired !== undefined ? b.apiKeyRequired : false,
    rateLimitPerMin: b.rateLimitPerMin !== undefined ? b.rateLimitPerMin : 100,
    cacheTtlSec: b.cacheTtlSec !== undefined ? b.cacheTtlSec : 0,
    description: b.description, enabled: b.enabled !== undefined ? b.enabled : true,
  };
};

const routeUpdateSchema = (b) => {
  const out = {};
  if (b.method !== undefined) out.method = b.method.toUpperCase();
  // Accept BOTH camelCase and snake_case from the client. The frontend
  // sends camelCase (via react-hook-form), but API clients (curl, Postman,
  // other services) may send snake_case to match the DB column names.
  // Without this, a snake_case update payload is silently dropped — the
  // service sees an empty patch, returns the existing row unchanged, and
  // the user's edit appears to "not persist."
  const publicPath = b.publicPath !== undefined ? b.publicPath : b.public_path;
  if (publicPath !== undefined) {
    if (!isString(publicPath, { max: 255 }) || !publicPath.startsWith('/')) throw new ValidationError('publicPath must start with /');
    out.public_path = publicPath;
  }
  const upstreamPath = b.upstreamPath !== undefined ? b.upstreamPath : b.upstream_path;
  if (upstreamPath !== undefined) out.upstream_path = upstreamPath;
  const stripPrefix = b.stripPrefix !== undefined ? b.stripPrefix : b.strip_prefix;
  if (stripPrefix !== undefined) out.strip_prefix = stripPrefix;
  const authRequired = b.authRequired !== undefined ? b.authRequired : b.auth_required;
  if (authRequired !== undefined) out.auth_required = authRequired;
  const apiKeyRequired = b.apiKeyRequired !== undefined ? b.apiKeyRequired : b.api_key_required;
  if (apiKeyRequired !== undefined) out.api_key_required = apiKeyRequired;
  const rateLimitPerMin = b.rateLimitPerMin !== undefined ? b.rateLimitPerMin : b.rate_limit_per_min;
  if (rateLimitPerMin !== undefined) out.rate_limit_per_min = rateLimitPerMin;
  const cacheTtlSec = b.cacheTtlSec !== undefined ? b.cacheTtlSec : b.cache_ttl_sec;
  if (cacheTtlSec !== undefined) out.cache_ttl_sec = cacheTtlSec;
  if (b.description !== undefined) out.description = b.description;
  if (b.enabled !== undefined) out.enabled = b.enabled;
  return out;
};

const apiKeyCreateSchema = (b) => {
  const name = ensureRequired(b.name, 'name');
  if (!isString(name, { max: 120 })) throw new ValidationError('name must be 1-120 chars');
  if (b.scopes !== undefined && !Array.isArray(b.scopes)) throw new ValidationError('scopes must be an array');
  if (b.rateLimitPerMin !== undefined && !isOptionalInt(b.rateLimitPerMin, { min: 1, max: 100000 })) throw new ValidationError('rateLimitPerMin must be 1-100000');
  return {
    name: name.trim(), scopes: b.scopes || [], rateLimitPerMin: b.rateLimitPerMin || 100,
    expiresInDays: b.expiresInDays || null, environment: b.environment === 'test' ? 'test' : 'live',
  };
};

const apiKeyUpdateSchema = (b) => {
  const out = {};
  if (b.name !== undefined) out.name = b.name.trim();
  if (b.scopes !== undefined) out.scopes = b.scopes;
  if (b.rateLimitPerMin !== undefined) out.rate_limit_per_min = b.rateLimitPerMin;
  if (b.enabled !== undefined) out.enabled = b.enabled;
  if (b.expiresAt !== undefined) out.expires_at = b.expiresAt;
  return out;
};

module.exports = {
  loginSchema, createUserSchema,
  serviceCreateSchema, serviceUpdateSchema,
  routeCreateSchema, routeUpdateSchema,
  apiKeyCreateSchema, apiKeyUpdateSchema,
};
