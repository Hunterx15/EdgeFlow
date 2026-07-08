/**
 * EdgeFlow - Services routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/servicesController');
const { asyncHandler } = require('../utils/asyncHandler');
const { body } = require('../middlewares/validate');
const { serviceCreateSchema, serviceUpdateSchema } = require('../schemas');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.get('/stats', asyncHandler(controller.stats));
router.get('/:id', asyncHandler(controller.getById));
router.get('/:id/health', asyncHandler(controller.checkHealth));
router.post('/', requireRole('admin'), body(serviceCreateSchema), asyncHandler(controller.create));
router.put('/:id', requireRole('admin'), body(serviceUpdateSchema), asyncHandler(controller.update));
router.patch('/:id/enabled', requireRole('admin'), asyncHandler(controller.setEnabled));
router.delete('/:id', requireRole('admin'), asyncHandler(controller.remove));

module.exports = router;
