/**
 * EdgeFlow - Routes routes
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/routesController');
const { asyncHandler } = require('../utils/asyncHandler');
const { body } = require('../middlewares/validate');
const { routeCreateSchema, routeUpdateSchema } = require('../schemas');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', requireRole('admin'), body(routeCreateSchema), asyncHandler(controller.create));
router.put('/:id', requireRole('admin'), body(routeUpdateSchema), asyncHandler(controller.update));
router.patch('/:id/enabled', requireRole('admin'), asyncHandler(controller.setEnabled));
router.delete('/:id', requireRole('admin'), asyncHandler(controller.remove));

module.exports = router;
