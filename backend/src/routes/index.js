/**
 * EdgeFlow - Route index
 */

const express = require('express');
const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/dashboard', require('./dashboardRoutes'));
router.use('/services', require('./serviceRoutes'));
router.use('/routes', require('./routeRoutes'));
router.use('/api-keys', require('./apiKeyRoutes'));
router.use('/logs', require('./logRoutes'));
router.use('/analytics', require('./analyticsRoutes'));
router.use('/monitoring', require('./monitoringRoutes'));
router.use('/playground', require('./playgroundRoutes'));

module.exports = router;
