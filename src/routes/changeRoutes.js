'use strict';

/**
 * changeRoutes.js — URL and HTTP method declarations for the changes resource.
 *
 * Mounted at /api/v1/changes in src/routes/index.js.
 * Middleware order per route: validation → controller.
 */

const express = require('express');
const controller = require('../controllers/changeController');
const { validateBody } = require('../middleware');
const { validateCreateChange } = require('../validators/changeValidator');

const router = express.Router();

// POST /api/v1/changes
router.post('/', validateBody(validateCreateChange), controller.createChange);

module.exports = router;
