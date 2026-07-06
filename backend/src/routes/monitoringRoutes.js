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
// BUG FIX: previously this used `:upstreamUrl` as a path parameter, but
// upstream URLs (e.g. http://user-svc:3001) contain `/` which makes path
// matching impossible. The upstream URL is now passed in the request body
// or query string instead. Supports both for convenience.
router.post('/circuit-breakers/reset', requireAuth, requireRole('admin'), asyncHandler(controller.resetCircuit));

module.exports = router;
