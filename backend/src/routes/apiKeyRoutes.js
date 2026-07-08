/**
 * EdgeFlow - API keys routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/apiKeysController');
const { asyncHandler } = require('../utils/asyncHandler');
const { body } = require('../middlewares/validate');
const { apiKeyCreateSchema, apiKeyUpdateSchema } = require('../schemas');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', requireRole('admin'), body(apiKeyCreateSchema), asyncHandler(controller.issue));
router.put('/:id', requireRole('admin'), body(apiKeyUpdateSchema), asyncHandler(controller.update));
router.patch('/:id/enabled', requireRole('admin'), asyncHandler(controller.setEnabled));
router.delete('/:id', requireRole('admin'), asyncHandler(controller.revoke));

module.exports = router;
