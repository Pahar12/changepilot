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

/**
 * GET /api/v1/changes
 * Returns a paginated, filtered list of ChangeRequests.
 * Query params are pre-validated and parsed by validateQuery middleware.
 */
async function listChanges(req, res) {
  // Read from req.parsedQuery — set by validateQuery middleware with typed values.
  const { filter, page, limit } = req.parsedQuery;
  const result = await changeService.listChanges({ filter, page, limit });
  res.status(200).json(result);
}

module.exports = { createChange, listChanges };
