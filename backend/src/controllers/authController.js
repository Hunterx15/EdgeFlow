/**
 * EdgeFlow - Auth controller
 */

const authService = require('../services/authService');
const { ok } = require('../utils/http');

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true, secure: req.secure || req.protocol === 'https',
      sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/v1/auth',
    });
    return ok(res, { user: result.user, accessToken: result.accessToken });
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    const result = await authService.refresh(refreshToken);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true, secure: req.secure || req.protocol === 'https',
      sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/api/v1/auth',
    });
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
