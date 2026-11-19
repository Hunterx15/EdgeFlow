/**
 * EdgeFlow - Auth service
 *
 * Talks to PostgreSQL directly (no repository layer per the simpler
 * architecture requirement). Handles login / refresh / logout / me.
 *
 * Multi-Device Token Rotation:
 * On every refresh we issue a new refresh token and rotate ONLY the
 * matching session JTI in users.refresh_token_jti (supports up to 5 concurrent
 * devices). If an unknown or already-rotated JTI is replayed, it detects
 * a replay attack and revokes all sessions for that user.
 */

const { queryOne, queryRaw } = require('../database/pool');
const { verifyPassword, hashPassword, needsRehash } = require('../utils/password');
const jwt = require('../utils/jwt');
const { UnauthorizedError, ConflictError, ValidationError } = require('../utils/http');
const logger = require('../utils/logger');

const USER_COLS = 'id, email, name, password_hash, role, is_active, last_login_at, refresh_token_jti, created_at, updated_at';
const MAX_CONCURRENT_SESSIONS = 5;

function parseJtiList(stored) {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  // Backwards compatibility with single legacy string JTI
  return [stored];
}

function serializeJtiList(jtis) {
  // Keep only the most recent N sessions
  return JSON.stringify(jtis.slice(-MAX_CONCURRENT_SESSIONS));
}

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

  const activeJtis = parseJtiList(user.refresh_token_jti);
  activeJtis.push(jti);

  await queryRaw('UPDATE users SET refresh_token_jti = $1, last_login_at = NOW() WHERE id = $2', [
    serializeJtiList(activeJtis),
    user.id,
  ]);
  return { user: sanitize(user), accessToken, refreshToken };
}

async function refresh(refreshToken) {
  const decoded = jwt.verifyRefreshToken(refreshToken);
  const user = await queryOne(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [decoded.sub]);
  if (!user || !user.is_active) throw new UnauthorizedError('User not found or disabled');

  const activeJtis = parseJtiList(user.refresh_token_jti);
  const index = activeJtis.indexOf(decoded.jti);
  if (index === -1) {
    logger.warn('auth: refresh token jti mismatch - possible replay attack', { userId: user.id });
    await queryRaw('UPDATE users SET refresh_token_jti = NULL WHERE id = $1', [user.id]);
    throw new UnauthorizedError('Refresh token has been revoked');
  }

  const newAccessToken = jwt.signAccessToken(user);
  const { token: newRefreshToken, jti: newJti } = jwt.signRefreshToken(user);

  // Rotate only the matched session JTI
  activeJtis[index] = newJti;
  await queryRaw('UPDATE users SET refresh_token_jti = $1 WHERE id = $2', [
    serializeJtiList(activeJtis),
    user.id,
  ]);
  return { user: sanitize(user), accessToken: newAccessToken, refreshToken: newRefreshToken };
}

async function logout(userId, refreshToken = null) {
  if (refreshToken) {
    try {
      const decoded = jwt.verifyRefreshToken(refreshToken);
      const user = await queryOne(`SELECT refresh_token_jti FROM users WHERE id = $1`, [userId]);
      if (user) {
        const activeJtis = parseJtiList(user.refresh_token_jti);
        const filtered = activeJtis.filter((j) => j !== decoded.jti);
        await queryRaw('UPDATE users SET refresh_token_jti = $1 WHERE id = $2', [
          filtered.length > 0 ? serializeJtiList(filtered) : null,
          userId,
        ]);
        return true;
      }
    } catch (_) {}
  }
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
