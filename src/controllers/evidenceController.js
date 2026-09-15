'use strict';

/**
 * evidenceController.js — HTTP translation layer for the Evidence resource.
 *
 * Same convention as changeController.js: read sanitised request data, call
 * the service, translate the result/error to an HTTP response. No business
 * rules, no validation logic, no Prisma calls here.
 */

const evidenceService = require('../services/evidenceService');

/**
 * POST /api/v1/changes/:id/evidence
 * Creates a new Evidence record attached to the given ChangeRequest.
 * Responds 201 with the created record.
 * Handles 403 (unauthorized owner), 404 (change request not found).
 */
async function createEvidence(req, res) {
  try {
    const record = await evidenceService.createEvidence(req.params.id, req.body, req.user);
    res.status(201).json({ status: 'success', data: record });
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    throw err; // unexpected — global error handler
  }
}

/**
 * GET /api/v1/changes/:id/evidence
 * Lists all Evidence attached to the given ChangeRequest, most recent first.
 * Responds 200 with the record array.
 * Handles 403 (unauthorized owner), 404 (change request not found).
 */
async function listEvidenceForChange(req, res) {
  try {
    const records = await evidenceService.listEvidenceForChange(req.params.id, req.user);
    res.status(200).json({ status: 'success', data: records });
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

/**
 * GET /api/v1/evidence/:id
 * Returns a single Evidence record by its own id.
 * Responds 200 on success.
 * Handles 403 (unauthorized owner), 404 (not found).
 */
async function getEvidenceById(req, res) {
  try {
    const record = await evidenceService.getEvidenceById(req.params.id, req.user);
    res.status(200).json({ status: 'success', data: record });
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    throw err;
  }
}

module.exports = { createEvidence, listEvidenceForChange, getEvidenceById };
