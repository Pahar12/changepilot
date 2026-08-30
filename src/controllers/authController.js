'use strict';

/**
 * src/controllers/authController.js — HTTP translation layer for authentication endpoints.
 *
 * Responsibilities:
 *   - Read sanitised data from req.body or req.user
 *   - Call authService
 *   - Map domain errors (401, 404, 409) to HTTP responses
 *   - Forward unexpected errors to the global error handler
 */

const authService = require('../services/authService');

/**
 * POST /api/v1/auth/register
 * Registers a new user with REQUESTER role.
 */
async function register(req, res) {
  try {
    const result = await authService.register(req.body);
    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials and returns JWT.
 */
async function login(req, res) {
  try {
    const result = await authService.login(req.body);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    if (err.statusCode === 401) {
      return res.status(401).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

/**
 * GET /api/v1/auth/me
 * Returns profile of the currently authenticated user.
 */
async function getMe(req, res) {
  try {
    const user = await authService.getMe(req.user.id);
    res.status(200).json({ status: 'success', data: { user } });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

module.exports = {
  register,
  login,
  getMe
};
