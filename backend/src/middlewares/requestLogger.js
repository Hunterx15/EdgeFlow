/**
 * EdgeFlow - Request-id + structured logger middleware
 */

const { generateRequestId } = require('../utils/http');
const logger = require('../utils/logger');

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.requestId = incoming && /^[a-zA-Z0-9_-]{1,128}$/.test(incoming) ? incoming : generateRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  req.log = logger.child({ requestId: req.requestId, method: req.method, path: req.path });
  req.log.debug('incoming request', { ip: req.ip, userAgent: req.headers['user-agent'] });
  next();
}

function responseLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const latencyMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log?.[level]?.('request completed', {
      statusCode: res.statusCode, latencyMs,
      contentLength: res.getHeader('content-length') || 0,
    });
  });
  next();
}

module.exports = { requestIdMiddleware, responseLogger };
