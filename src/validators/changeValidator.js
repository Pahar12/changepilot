'use strict';

/**
 * changeValidator.js — pure input validation for the ChangeRequest resource.
 *
 * Returns { errors: Array<{field: string, message: string}>, data: Object|null }.
 * Callers check errors.length to decide whether to proceed.
 * No Express, no Prisma, no side-effects: easy to unit-test.
 */

const VALID_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Fields the client is permitted to send on a CREATE request.
// id, status, createdAt, updatedAt are server-controlled and must be rejected.
const ALLOWED_FIELDS = ['title', 'description', 'riskLevel'];

/**
 * Validate the body of a POST /api/v1/changes request.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 *   errors — accumulated validation failures (empty = valid)
 *   data   — sanitised fields ready for the service (null when errors exist)
 */
function validateCreateChange(body) {
  const errors = [];
  const raw = body || {};

  // ── Unknown / forbidden fields ──────────────────────────────────────────────
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      errors.push({ field: key, message: `Field "${key}" is not permitted` });
    }
  }

  // ── title ───────────────────────────────────────────────────────────────────
  let title;
  if (raw.title === undefined || raw.title === null) {
    errors.push({ field: 'title', message: 'title is required' });
  } else if (typeof raw.title !== 'string') {
    errors.push({ field: 'title', message: 'title must be a string' });
  } else {
    title = raw.title.trim();
    if (title.length === 0) {
      errors.push({ field: 'title', message: 'title must not be empty' });
      title = undefined;
    } else if (title.length > 100) {
      errors.push({ field: 'title', message: 'title must not exceed 100 characters' });
      title = undefined;
    }
  }

  // ── description (optional) ──────────────────────────────────────────────────
  let description;
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') {
      errors.push({ field: 'description', message: 'description must be a string' });
    } else {
      description = raw.description.trim();
    }
  }

  // ── riskLevel (optional) ────────────────────────────────────────────────────
  let riskLevel;
  if (raw.riskLevel !== undefined && raw.riskLevel !== null) {
    if (!VALID_RISK_LEVELS.includes(raw.riskLevel)) {
      errors.push({
        field: 'riskLevel',
        message: `riskLevel must be one of: ${VALID_RISK_LEVELS.join(', ')}`
      });
    } else {
      riskLevel = raw.riskLevel;
    }
  }

  if (errors.length > 0) {
    return { errors, data: null };
  }

  return {
    errors: [],
    data: {
      title,
      ...(description !== undefined && { description }),
      ...(riskLevel   !== undefined && { riskLevel })
    }
  };
}

module.exports = { validateCreateChange };
