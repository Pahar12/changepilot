'use strict';

/**
 * changeController.js — HTTP translation layer for the ChangeRequest resource.
 *
 * Responsibilities (only these):
 *   - Read sanitised data from req.body (validation middleware runs first)
 *   - Call the service
 *   - Send the HTTP response
 *
 * No business rules, no validation logic, no Prisma calls here.
 * Express 5 automatically forwards thrown errors from async functions to the
 * global error handler registered in app.js.
 */

const changeService = require('../services/changeService');

/**
 * POST /api/v1/changes
 * Creates a new ChangeRequest in DRAFT status.
 * Responds 201 with the created record.
 */
async function createChange(req, res) {
  const record = await changeService.createChange(req.body);
  res.status(201).json({ status: 'success', data: record });
}

module.exports = { createChange };
