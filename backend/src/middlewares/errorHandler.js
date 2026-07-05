/**
 * EdgeFlow - Error handler + 404 middleware
 */

const logger = require('../utils/logger');
const { AppError, fail } = require('../utils/http');
const config = require('../config');

// Re-export errors for convenience
module.exports = require('../utils/http');

function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || 'unknown';
  if (err instanceof AppError) {
    if (err.isOperational) req.log?.warn?.('operational error', { code: err.code, message: err.message });
    else req.log?.error?.('non-operational AppError', { code: err.code, message: err.message, stack: err.stack });
    return fail(res, { code: err.code, message: err.message, details: err.details, status: err.status });
  }
  if (err.name === 'UnauthorizedError') return fail(res, { code: 'UNAUTHORIZED', message: err.message || 'Unauthorized', status: 401 });
  logger.error('unhandled error', { requestId, error: err.message, stack: err.stack, path: req.path, method: req.method });
  return fail(res, {
    code: 'INTERNAL_ERROR',
    message: config.isProduction ? 'Internal server error' : err.message,
    details: config.isProduction ? null : { stack: err.stack },
    status: 500,
  });
}

function notFound(req, res) {
  return fail(res, { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, status: 404 });
}

module.exports = { errorHandler, notFound };
