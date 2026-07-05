/**
 * EdgeFlow - Logs routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/logsController');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middlewares/auth');

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.get('/timeline', asyncHandler(controller.timeline));
router.get('/:id', asyncHandler(controller.getById));
router.get('/:id/pipeline', asyncHandler(controller.pipeline));

module.exports = router;
