/**
 * EdgeFlow - HTTP response helpers + error hierarchy
 *
 * Every controller uses these helpers so the response shape is identical:
 *   Success: { success: true, data, meta? }
 *   Error:   { success: false, error: { code, message, details? } }
 */

const config = require('../config');

function ok(res, data, meta = {}, status = 200) {
  return res.status(status).json({ success: true, data, meta: meta || {} });
}
function created(res, data, meta = {}) { return ok(res, data, meta, 201); }
function noContent(res) { return res.status(204).end(); }
function fail(res, { code = 'INTERNAL_ERROR', message = 'Internal server error', details = null, status = 500 }) {
  return res.status(status).json({ success: false, error: { code, message, details } });
}

const ERROR_CODES = {
  BAD_REQUEST: { status: 400, message: 'Bad request' },
  VALIDATION_ERROR: { status: 400, message: 'Validation failed' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  TOKEN_EXPIRED: { status: 401, message: 'Token expired' },
  TOKEN_INVALID: { status: 401, message: 'Invalid token' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Not found' },
  CONFLICT: { status: 409, message: 'Conflict' },
  RATE_LIMITED: { status: 429, message: 'Too many requests' },
  CIRCUIT_OPEN: { status: 503, message: 'Service unavailable (circuit breaker open)' },
  UPSTREAM_TIMEOUT: { status: 504, message: 'Upstream timeout' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
};

function paginate({ page, limit, total }) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } };
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f];
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---- Error hierarchy ----
class AppError extends Error {
  constructor(code, message, { status = 500, details = null, isOperational = true } = {}) {
    super(message);
    this.name = 'AppError'; this.code = code; this.status = status;
    this.details = details; this.isOperational = isOperational;
  }
}
class ValidationError extends AppError {
  constructor(m, d = null) { super('VALIDATION_ERROR', m, { status: 400, details: d }); this.name = 'ValidationError'; }
}
class UnauthorizedError extends AppError {
  constructor(m = 'Unauthorized', d = null) { super('UNAUTHORIZED', m, { status: 401, details: d }); this.name = 'UnauthorizedError'; }
}
class ForbiddenError extends AppError {
  constructor(m = 'Forbidden', d = null) { super('FORBIDDEN', m, { status: 403, details: d }); this.name = 'ForbiddenError'; }
}
class NotFoundError extends AppError {
  constructor(r = 'Resource', d = null) { super('NOT_FOUND', `${r} not found`, { status: 404, details: d }); this.name = 'NotFoundError'; }
}
class ConflictError extends AppError {
  constructor(m = 'Conflict', d = null) { super('CONFLICT', m, { status: 409, details: d }); this.name = 'ConflictError'; }
}
class RateLimitError extends AppError {
  constructor(m = 'Too many requests', d = null) { super('RATE_LIMITED', m, { status: 429, details: d }); this.name = 'RateLimitError'; }
}
class CircuitOpenError extends AppError {
  constructor(m = 'Circuit breaker open', d = null) { super('CIRCUIT_OPEN', m, { status: 503, details: d }); this.name = 'CircuitOpenError'; }
}

module.exports = {
  ok, created, noContent, fail, ERROR_CODES, paginate, pick, sleep, generateRequestId,
  AppError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError,
  ConflictError, RateLimitError, CircuitOpenError,
};
