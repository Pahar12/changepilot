'use strict';

/**
 * changeRoutes.js — URL and HTTP method declarations for the changes resource.
 *
 * Mounted at /api/v1/changes in src/routes/index.js.
 * Middleware order per route: validation → controller.
 */

const express = require('express');
const controller = require('../controllers/changeController');
const { validateBody, validateQuery, validateParam } = require('../middleware');
const { validateCreateChange, validateListChanges, validateChangeId } = require('../validators/changeValidator');

const router = express.Router();

// GET  /api/v1/changes
router.get('/', validateQuery(validateListChanges), controller.listChanges);

// GET  /api/v1/changes/:id
router.get('/:id', validateParam('id', validateChangeId), controller.getChangeById);

// POST /api/v1/changes
router.post('/', validateBody(validateCreateChange), controller.createChange);

module.exports = router;
