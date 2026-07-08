/**
 * EdgeFlow - Auth service
 *
 * Talks to PostgreSQL directly (no repository layer per the simpler
 * architecture requirement). Handles login / refresh / logout / me.
 *
 * Token rotation: on every refresh we issue a new refresh token AND
 * invalidate the previous one (by updating refresh_token_jti). Detects
 * replay attacks: if a stolen refresh token is replayed after the
 * legitimate user refreshed, the jti won't match -> 401 + revoke.
 */

const { queryOne, queryRaw } = require('../database/pool');
const { verifyPassword, hashPassword, needsRehash } = require('../utils/password');
const jwt = require('../utils/jwt');
const { UnauthorizedError, ConflictError, ValidationError } = require('../utils/http');
const logger = require('../utils/logger');

const USER_COLS = 'id, email, name, password_hash, role, is_active, last_login_at, refresh_token_jti, created_at, updated_at';

async function login({ email, password }) {
  if (!email || !password) throw new ValidationError('Email and password are required');
  const user = await queryOne(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
  if (!user || !user.is_active) throw new UnauthorizedError('Invalid credentials');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  if (needsRehash(user.password_hash)) {
    const newHash = await hashPassword(password);
    await queryRaw('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    logger.info('auth: rehashed password on login', { userId: user.id });
  }

  const accessToken = jwt.signAccessToken(user);
  const { token: refreshToken, jti } = jwt.signRefreshToken(user);
  await queryRaw('UPDATE users SET refresh_token_jti = $1, last_login_at = NOW() WHERE id = $2', [jti, user.id]);
  return { user: sanitize(user), accessToken, refreshToken };
}

async function refresh(refreshToken) {
  const decoded = jwt.verifyRefreshToken(refreshToken);
  const user = await queryOne(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [decoded.sub]);
  if (!user || !user.is_active) throw new UnauthorizedError('User not found or disabled');
  if (user.refresh_token_jti !== decoded.jti) {
    logger.warn('auth: refresh token jti mismatch - possible replay attack', { userId: user.id });
    await queryRaw('UPDATE users SET refresh_token_jti = NULL WHERE id = $1', [user.id]);
    throw new UnauthorizedError('Refresh token has been revoked');
  }
  const newAccessToken = jwt.signAccessToken(user);
  const { token: newRefreshToken, jti: newJti } = jwt.signRefreshToken(user);
  await queryRaw('UPDATE users SET refresh_token_jti = $1 WHERE id = $2', [newJti, user.id]);
  return { user: sanitize(user), accessToken: newAccessToken, refreshToken: newRefreshToken };
}

async function logout(userId) {
  await queryRaw('UPDATE users SET refresh_token_jti = NULL WHERE id = $1', [userId]);
  return true;
}

async function me(userId) {
  const user = await queryOne(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [userId]);
  if (!user) throw new UnauthorizedError('User not found');
  return sanitize(user);
}

async function createUser({ email, name, password, role = 'admin' }) {
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (existing) throw new ConflictError('Email already registered');
  const passwordHash = await hashPassword(password);
  const user = await queryOne(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
     RETURNING ${USER_COLS}`,
    [email.toLowerCase().trim(), name, passwordHash, role]
  );
  return sanitize(user);
}

function sanitize(user) {
  if (!user) return null;
  return {
    id: user.id, email: user.email, name: user.name, role: user.role,
    isActive: user.is_active, lastLoginAt: user.last_login_at,
    createdAt: user.created_at, updatedAt: user.updated_at,
  };
}

module.exports = { login, refresh, logout, me, createUser, sanitize };
