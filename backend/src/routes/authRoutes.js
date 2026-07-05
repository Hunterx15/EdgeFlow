/**
 * EdgeFlow - Auth routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/authController');
const { asyncHandler } = require('../utils/asyncHandler');
const { body } = require('../middlewares/validate');
const { loginSchema, createUserSchema } = require('../schemas');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.post('/login', body(loginSchema), asyncHandler(controller.login));
router.post('/refresh', asyncHandler(controller.refresh));
router.post('/logout', requireAuth, asyncHandler(controller.logout));
router.get('/me', requireAuth, asyncHandler(controller.me));

if (process.env.NODE_ENV !== 'production') {
  router.post('/seed', body(createUserSchema), asyncHandler(async (req, res) => {
    const authService = require('../services/authService');
    const user = await authService.createUser(req.body);
    return res.status(201).json({ success: true, data: { user } });
  }));
}

module.exports = router;
