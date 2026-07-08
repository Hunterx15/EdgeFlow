/**
 * EdgeFlow - Dashboard routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/dashboardController');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middlewares/auth');

router.use(requireAuth);

router.get('/overview', asyncHandler(controller.overview));
router.get('/live-graph', asyncHandler(controller.liveGraph));
router.get('/live-metrics', asyncHandler(controller.liveMetrics));

module.exports = router;
