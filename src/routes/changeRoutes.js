'use strict';

/**
 * changeRoutes.js — URL and HTTP method declarations for the changes resource.
 *
 * Mounted at /api/v1/changes in src/routes/index.js.
 * Middleware order per route: validation → controller.
 */

const express = require('express');
const controller = require('../controllers/changeController');
const { validateBody, validateQuery, validateParam, authenticate, authorize } = require('../middleware');
const {
  validateCreateChange,
  validateListChanges,
  validateChangeId,
  validateSubmitChange,
  validateApproveChange,
  validateRejectChange,
  validateCloseChange,
  validateUpdateChange
} = require('../validators/changeValidator');

const router = express.Router();

// Require authentication for all change request endpoints
router.use(authenticate);

// GET  /api/v1/changes
router.get('/', authorize(['REQUESTER', 'REVIEWER', 'ADMIN']), validateQuery(validateListChanges), controller.listChanges);

// POST /api/v1/changes/:id/submit  — declared before /:id to prevent shadowing
router.post(
  '/:id/submit',
  authorize(['REQUESTER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateSubmitChange),
  controller.submitChange
);

// POST /api/v1/changes/:id/approve
router.post(
  '/:id/approve',
  authorize(['REVIEWER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateApproveChange),
  controller.approveChange
);

// POST /api/v1/changes/:id/reject
router.post(
  '/:id/reject',
  authorize(['REVIEWER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateRejectChange),
  controller.rejectChange
);

// POST /api/v1/changes/:id/close
router.post(
  '/:id/close',
  authorize(['REVIEWER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateCloseChange),
  controller.closeChange
);

// PATCH /api/v1/changes/:id
router.patch(
  '/:id',
  authorize(['REQUESTER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateUpdateChange),
  controller.updateChange
);

// GET  /api/v1/changes/:id
router.get('/:id', authorize(['REQUESTER', 'REVIEWER', 'ADMIN']), validateParam('id', validateChangeId), controller.getChangeById);

// POST /api/v1/changes
router.post('/', authorize(['REQUESTER', 'ADMIN']), validateBody(validateCreateChange), controller.createChange);

module.exports = router;
