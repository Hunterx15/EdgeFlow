/**
 * EdgeFlow - Auth controller
 *
 * Handles login, refresh, logout, and me endpoints. Refresh tokens are
 * stored in httpOnly cookies with the Secure flag set based on the
 * environment (always secure in production, opt-in in dev via HTTPS).
 *
 * SECURITY:
 *   - With `trust proxy` configured (app.js), req.secure correctly reflects
 *     the real client connection (including through TLS-terminating proxies).
 *   - In production (NODE_ENV=production), the Secure flag is ALWAYS set,
 *     even if req.secure is false (e.g. if trust proxy is misconfigured).
 *     This prevents refresh tokens from being sent over HTTP.
 *   - sameSite: 'strict' provides CSRF protection for the refresh cookie.
 *     A cross-site request cannot send the cookie, so an attacker cannot
 *     trigger a token refresh on behalf of the victim.
 */

const authService = require('../services/authService');
const config = require('../config');
const { ok } = require('../utils/http');

function getCookieOptions() {
  // In production, always set secure: true. In dev, use req.secure so
  // HTTPS dev setups work, but HTTP dev (localhost) doesn't break.
  const secure = config.isProduction ? true : undefined;
  return {
    httpOnly: true,
    // secure is set per-request in the controller (depends on req.secure)
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/v1/auth',
  };
}

function shouldSetSecure(req) {
  // In production, ALWAYS set Secure. In dev, set it if the request is
  // actually HTTPS (so the cookie works in HTTPS dev but doesn't break
  // HTTP localhost dev).
  if (config.isProduction) return true;
  return req.secure || req.protocol === 'https';
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    const cookieOpts = getCookieOptions();
    cookieOpts.secure = shouldSetSecure(req);
    res.cookie('refreshToken', result.refreshToken, cookieOpts);
    return ok(res, { user: result.user, accessToken: result.accessToken });
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    const result = await authService.refresh(refreshToken);
    const cookieOpts = getCookieOptions();
    cookieOpts.secure = shouldSetSecure(req);
    res.cookie('refreshToken', result.refreshToken, cookieOpts);
    return ok(res, { user: result.user, accessToken: result.accessToken });
  } catch (err) { next(err); }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.user.id);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return ok(res, { loggedOut: true });
  } catch (err) { next(err); }
}

async function me(req, res, next) {
  try {
    const user = await authService.me(req.user.id);
    return ok(res, { user });
  } catch (err) { next(err); }
}

module.exports = { login, refresh, logout, me };
