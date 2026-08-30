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

/**
 * GET /api/v1/changes/:id
 * Returns a single ChangeRequest by ID.
 * Responds 200 on success, 404 when the record does not exist.
 */
async function getChangeById(req, res) {
  try {
    const record = await changeService.getChangeById(req.params.id);
    res.status(200).json({ data: record });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    throw err; // unexpected error — let the global error handler deal with it
  }
}

/**
 * POST /api/v1/changes/:id/submit
 * Transitions a DRAFT ChangeRequest to UNDER_REVIEW.
 * Responds 200 on success.
 * Handles 400 (blank description), 404 (not found), 409 (wrong status).
 */
async function submitChange(req, res) {
  try {
    const record = await changeService.submitChange(req.params.id);
    res.status(200).json({ data: record });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 400) {
      return res.status(400).json({
        status: 'fail',
        errors: [{ field: 'description', message: err.message }]
      });
    }
    throw err; // unexpected — global error handler
  }
}

/**
 * POST /api/v1/changes/:id/approve
 * Transitions an UNDER_REVIEW ChangeRequest to APPROVED.
 * Responds 200 on success.
 * Handles 404 (not found), 409 (wrong status).
 */
async function approveChange(req, res) {
  try {
    const record = await changeService.approveChange(req.params.id);
    res.status(200).json({ data: record });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

/**
 * POST /api/v1/changes/:id/reject
 * Transitions an UNDER_REVIEW ChangeRequest to REJECTED.
 * Responds 200 on success.
 * Handles 404 (not found), 409 (wrong status).
 */
async function rejectChange(req, res) {
  try {
    const record = await changeService.rejectChange(req.params.id);
    res.status(200).json({ data: record });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

/**
 * POST /api/v1/changes/:id/close
 * Transitions an APPROVED or REJECTED ChangeRequest to CLOSED.
 * Responds 200 on success.
 * Handles 404 (not found), 409 (wrong status).
 */
async function closeChange(req, res) {
  try {
    const record = await changeService.closeChange(req.params.id);
    res.status(200).json({ data: record });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

/**
 * PATCH /api/v1/changes/:id
 * Applies a partial update to a DRAFT ChangeRequest.
 * Responds 200 on success.
 * Handles 404 (not found), 409 (not DRAFT).
 */
async function updateChange(req, res) {
  try {
    const record = await changeService.updateChange(req.params.id, req.body);
    res.status(200).json({ data: record });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 409) {
      return res.status(409).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

module.exports = { createChange, listChanges, getChangeById, submitChange, approveChange, rejectChange, closeChange, updateChange };
