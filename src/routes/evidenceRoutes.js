'use strict';

/**
 * evidenceRoutes.js — URL and HTTP method declarations for standalone
 * single-Evidence access.
 *
 * Mounted at /api/v1/evidence in src/routes/index.js.
 *
 * The two ChangeRequest-scoped evidence endpoints (create, list-for-change)
 * live in changeRoutes.js alongside the rest of the /api/v1/changes/:id/*
 * actions — this file is only for accessing a single Evidence record
 * directly by its own id.
 */

const express = require('express');
const controller = require('../controllers/evidenceController');
const { validateParam, authenticate, authorize } = require('../middleware');
const { validateEvidenceId } = require('../validators/evidenceValidator');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/evidence/:id
router.get(
  '/:id',
  authorize(['REQUESTER', 'REVIEWER', 'ADMIN']),
  validateParam('id', validateEvidenceId),
  controller.getEvidenceById
);

module.exports = router;
