/**
 * EdgeFlow - JWT utilities
 *
 * Issues and verifies access (15m) + refresh (7d) tokens. Refresh tokens
 * are tracked by jti in PostgreSQL so they can be rotated on login and
 * revoked on logout / detected on replay.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');

class JwtError extends Error {
  constructor(code, message) { super(message); this.name = 'JwtError'; this.code = code; }
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, type: 'access' },
    config.jwt.secret, {
      expiresIn: config.jwt.accessExpiresIn,
      issuer: config.jwt.issuer, audience: config.jwt.audience,
    });
}

function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, email: user.email, type: 'refresh', jti },
    config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: config.jwt.issuer, audience: config.jwt.audience,
    });
  return { token, jti };
}

function verifyAccessToken(token) {
  if (!token) throw new JwtError('missing', 'Access token is required');
  try {
    return jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer, audience: config.jwt.audience });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new JwtError('expired', 'Access token expired');
    throw new JwtError('invalid', `Invalid access token: ${err.message}`);
  }
}

function verifyRefreshToken(token) {
  if (!token) throw new JwtError('missing', 'Refresh token is required');
  try {
    return jwt.verify(token, config.jwt.refreshSecret, { issuer: config.jwt.issuer, audience: config.jwt.audience });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new JwtError('expired', 'Refresh token expired');
    throw new JwtError('invalid', `Invalid refresh token: ${err.message}`);
  }
}

module.exports = { JwtError, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
