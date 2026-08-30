'use strict';

const express = require('express');

const healthRoutes = require('./healthRoutes');
const authRoutes   = require('./authRoutes');
const changeRoutes = require('./changeRoutes');

const router = express.Router();

// GET /api/health
router.use(healthRoutes);

// Auth: /api/v1/auth (register, login, me)
router.use('/v1/auth', authRoutes);

// ChangeRequests: /api/v1/changes
router.use('/v1/changes', changeRoutes);

module.exports = router;
