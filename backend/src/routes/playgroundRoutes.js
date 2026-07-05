/**
 * EdgeFlow - Playground routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/playgroundController');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middlewares/auth');

router.use(requireAuth);

router.post('/send', asyncHandler(controller.send));

module.exports = router;
