/**
 * EdgeFlow - JWT utilities
 *
 * Issues and verifies access (15m) + refresh (7d) tokens. Refresh tokens
 * are tracked by jti in PostgreSQL so they can be rotated on login and
 * revoked on logout / detected on replay.
 *
 * SECURITY:
 *   - Access and refresh tokens use DIFFERENT secrets (prevents cross-use).
 *   - The `type` claim is verified on every token — an access token cannot
 *     be used as a refresh token and vice versa, even if secrets match.
 *   - Algorithm is pinned to HS256 to prevent algorithm-confusion attacks.
 *   - Error messages are generic (no internal verification details leaked).
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
      algorithm: 'HS256',
    });
}

function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, email: user.email, type: 'refresh', jti },
    config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: config.jwt.issuer, audience: config.jwt.audience,
      algorithm: 'HS256',
    });
  return { token, jti };
}

function verifyAccessToken(token) {
  if (!token) throw new JwtError('missing', 'Access token is required');
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithms: ['HS256'],
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new JwtError('expired', 'Access token expired');
    throw new JwtError('invalid', 'Invalid access token');
  }
  // Verify the type claim — prevents token confusion even if secrets match.
  if (decoded.type !== 'access') {
    throw new JwtError('invalid', 'Invalid access token');
  }
  return decoded;
}

function verifyRefreshToken(token) {
  if (!token) throw new JwtError('missing', 'Refresh token is required');
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.refreshSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithms: ['HS256'],
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new JwtError('expired', 'Refresh token expired');
    throw new JwtError('invalid', 'Invalid refresh token');
  }
  if (decoded.type !== 'refresh') {
    throw new JwtError('invalid', 'Invalid refresh token');
  }
  return decoded;
}

module.exports = { JwtError, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
