/**
 * EdgeFlow - Analytics routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/analyticsController');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middlewares/auth');

router.use(requireAuth);

router.get('/overview', asyncHandler(controller.overview));
router.get('/per-minute', asyncHandler(controller.perMinute));
router.get('/per-service', asyncHandler(controller.perService));
router.get('/top-routes', asyncHandler(controller.topRoutes));
router.get('/status-breakdown', asyncHandler(controller.statusBreakdown));

module.exports = router;
