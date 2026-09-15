'use strict';

const express = require('express');

const healthRoutes   = require('./healthRoutes');
const authRoutes     = require('./authRoutes');
const changeRoutes   = require('./changeRoutes');
const evidenceRoutes = require('./evidenceRoutes');

const router = express.Router();

// GET /api/health
router.use(healthRoutes);

// Auth: /api/v1/auth (register, login, me)
router.use('/v1/auth', authRoutes);

// ChangeRequests: /api/v1/changes (also owns /api/v1/changes/:id/evidence — see changeRoutes.js)
router.use('/v1/changes', changeRoutes);

// Evidence: /api/v1/evidence/:id (standalone single-record access)
router.use('/v1/evidence', evidenceRoutes);

module.exports = router;
