'use strict';

/**
 * aiController.js — HTTP translation layer for AI analysis.
 *
 * Same convention as changeController.js: read sanitised request data, call
 * the service, translate the result/error to an HTTP response. No business
 * rules, no validation logic, no Prisma or AI-provider calls here.
 */

const aiAnalysisService = require('../services/aiAnalysisService');

/**
 * POST /api/v1/changes/:id/analyze
 * Runs an AI risk assessment for a ChangeRequest and persists the result.
 * Responds 201 with the created AIAnalysis record.
 * Handles 403 (unauthorized owner), 404 (not found), 502 (AI provider failure or invalid output).
 */
async function analyzeChange(req, res) {
  try {
    const analysis = await aiAnalysisService.analyzeChangeRequest(req.params.id, req.user);
    res.status(201).json({ status: 'success', data: analysis });
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({ status: 'fail', message: err.message });
    }
    if (err.statusCode === 502) {
      return res.status(502).json({
        status: 'fail',
        message: err.message,
        ...(err.errors && { errors: err.errors })
      });
    }
    throw err; // unexpected — global error handler
  }
}

module.exports = { analyzeChange };
