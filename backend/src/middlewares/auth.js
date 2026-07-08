/**
 * EdgeFlow - Authentication + role middleware
 *
 * requireAuth:       token mandatory, attaches req.user
 * optionalAuth:      token optional
 * requireRole(roles): role-based access control
 */

const jwt = require('../utils/jwt');
const { fail, ERROR_CODES } = require('../utils/http');

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return fail(res, { ...ERROR_CODES.UNAUTHORIZED, message: 'Missing or malformed Authorization header' });
  try {
    const decoded = jwt.verifyAccessToken(token);
    req.user = { id: decoded.sub, email: decoded.email, role: decoded.role };
    return next();
  } catch (err) {
    if (err.code === 'expired') return fail(res, { ...ERROR_CODES.TOKEN_EXPIRED, message: err.message });
    return fail(res, { ...ERROR_CODES.TOKEN_INVALID, message: err.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, { ...ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return fail(res, { ...ERROR_CODES.FORBIDDEN, message: `This endpoint requires one of: ${roles.join(', ')}` });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
