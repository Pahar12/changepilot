'use strict';

/**
 * changeRoutes.js — URL and HTTP method declarations for the changes resource.
 *
 * Mounted at /api/v1/changes in src/routes/index.js.
 * Middleware order per route: validation → controller.
 */

const express = require('express');
const controller = require('../controllers/changeController');
const aiController = require('../controllers/aiController');
const evidenceController = require('../controllers/evidenceController');
const { validateBody, validateQuery, validateParam, authenticate, authorize } = require('../middleware');
const {
  validateCreateChange,
  validateListChanges,
  validateChangeId,
  validateSubmitChange,
  validateApproveChange,
  validateRejectChange,
  validateCloseChange,
  validateUpdateChange,
  validateAnalyzeChange
} = require('../validators/changeValidator');
const { validateCreateEvidence } = require('../validators/evidenceValidator');

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

// POST /api/v1/changes/:id/analyze — declared before /:id to prevent shadowing
// All three roles may call this; ownership for REQUESTER is enforced in
// aiAnalysisService (mirrors the ownership check in changeService), same
// pattern as the RBAC/ownership split used throughout this router.
router.post(
  '/:id/analyze',
  authorize(['REQUESTER', 'REVIEWER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateAnalyzeChange),
  aiController.analyzeChange
);

// POST /api/v1/changes/:id/evidence — declared before /:id to prevent shadowing
// Same role split as POST /api/v1/changes (creation): REQUESTER and ADMIN
// only. Ownership for REQUESTER (must own the parent ChangeRequest) is
// enforced in evidenceService, mirroring every other ownership check in
// this router.
router.post(
  '/:id/evidence',
  authorize(['REQUESTER', 'ADMIN']),
  validateParam('id', validateChangeId),
  validateBody(validateCreateEvidence),
  evidenceController.createEvidence
);

// GET /api/v1/changes/:id/evidence — declared before /:id to prevent shadowing
// Same role set as GET /api/v1/changes (list/read): all three roles: REVIEWER
// and ADMIN see any ChangeRequest's evidence; REQUESTER is restricted to
// their own ChangeRequest's evidence in evidenceService.
router.get(
  '/:id/evidence',
  authorize(['REQUESTER', 'REVIEWER', 'ADMIN']),
  validateParam('id', validateChangeId),
  evidenceController.listEvidenceForChange
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
