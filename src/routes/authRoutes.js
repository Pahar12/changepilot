'use strict';

/**
 * src/routes/authRoutes.js — URL and HTTP method declarations for authentication.
 *
 * Mounted at /api/v1/auth in src/routes/index.js.
 */

const express = require('express');
const authController = require('../controllers/authController');
const { validateBody, authenticate } = require('../middleware');
const { validateRegister, validateLogin } = require('../validators/authValidator');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', validateBody(validateRegister), authController.register);

// POST /api/v1/auth/login
router.post('/login', validateBody(validateLogin), authController.login);

// GET  /api/v1/auth/me
router.get('/me', authenticate, authController.getMe);

module.exports = router;
