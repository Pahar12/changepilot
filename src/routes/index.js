'use strict';

const express = require('express');

const healthRoutes = require('./healthRoutes');
const changeRoutes = require('./changeRoutes');

const router = express.Router();

// Existing: GET /api/health
router.use(healthRoutes);

// Phase 1: POST /api/v1/changes
router.use('/v1/changes', changeRoutes);

module.exports = router;
