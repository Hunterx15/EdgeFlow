/**
 * EdgeFlow - Monitoring routes (health, cache, circuit breakers, dependency graph)
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/monitoringController');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.get('/live', asyncHandler(controller.liveness));
router.get('/ready', asyncHandler(controller.readiness));
router.get('/dependency-graph', requireAuth, asyncHandler(controller.dependencyGraph));

router.get('/cache/stats', requireAuth, asyncHandler(controller.cacheStats));
router.post('/cache/flush', requireAuth, requireRole('admin'), asyncHandler(controller.cacheFlush));
router.post('/cache/invalidate', requireAuth, requireRole('admin'), asyncHandler(controller.cacheInvalidate));

router.get('/circuit-breakers', requireAuth, asyncHandler(controller.circuitBreakers));
router.post('/circuit-breakers/:upstreamUrl/reset', requireAuth, requireRole('admin'), asyncHandler(controller.resetCircuit));

module.exports = router;
