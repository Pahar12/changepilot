'use strict';

/**
 * changeRoutes.js — URL and HTTP method declarations for the changes resource.
 *
 * Mounted at /api/v1/changes in src/routes/index.js.
 * Middleware order per route: validation → controller.
 */

const express = require('express');
const controller = require('../controllers/changeController');
const { validateBody, validateQuery } = require('../middleware');
const { validateCreateChange, validateListChanges } = require('../validators/changeValidator');

const router = express.Router();

// GET  /api/v1/changes
router.get('/', validateQuery(validateListChanges), controller.listChanges);

// POST /api/v1/changes
router.post('/', validateBody(validateCreateChange), controller.createChange);

module.exports = router;
