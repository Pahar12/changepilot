'use strict';

/**
 * changeValidator.js — pure input validation for the ChangeRequest resource.
 *
 * Returns { errors: Array<{field: string, message: string}>, data: Object|null }.
 * Callers check errors.length to decide whether to proceed.
 * No Express, no Prisma, no side-effects: easy to unit-test.
 */

const VALID_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_STATUSES    = ['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'];

// Fields the client is permitted to send on a CREATE request.
// id, status, createdAt, updatedAt are server-controlled and must be rejected.
const ALLOWED_FIELDS = ['title', 'description', 'riskLevel'];

// Query parameters the client is permitted to send on a LIST request.
const ALLOWED_QUERY_PARAMS = ['status', 'riskLevel', 'page', 'limit'];

const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

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

/**
 * Validate query parameters for GET /api/v1/changes.
 *
 * @param {Object} query - raw req.query (all values are strings or undefined)
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 *   data — { filter: Object, page: number, limit: number } when valid
 */
function validateListChanges(query) {
  const errors = [];
  const raw = query || {};

  // ── Unknown query parameters ────────────────────────────────────────────────
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_QUERY_PARAMS.includes(key)) {
      errors.push({ field: key, message: `Unknown query parameter: "${key}"` });
    }
  }

  // ── status (optional) ───────────────────────────────────────────────────────
  let status;
  if (raw.status !== undefined) {
    if (!VALID_STATUSES.includes(raw.status)) {
      errors.push({
        field: 'status',
        message: `status must be one of: ${VALID_STATUSES.join(', ')}`
      });
    } else {
      status = raw.status;
    }
  }

  // ── riskLevel (optional) ────────────────────────────────────────────────────
  let riskLevel;
  if (raw.riskLevel !== undefined) {
    if (!VALID_RISK_LEVELS.includes(raw.riskLevel)) {
      errors.push({
        field: 'riskLevel',
        message: `riskLevel must be one of: ${VALID_RISK_LEVELS.join(', ')}`
      });
    } else {
      riskLevel = raw.riskLevel;
    }
  }

  // ── page (optional, default 1) ──────────────────────────────────────────────
  let page = DEFAULT_PAGE;
  if (raw.page !== undefined) {
    const n = Number(raw.page);
    if (!Number.isInteger(n) || n < 1) {
      errors.push({ field: 'page', message: 'page must be an integer >= 1' });
    } else {
      page = n;
    }
  }

  // ── limit (optional, default 20, max 100) ───────────────────────────────────
  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    const n = Number(raw.limit);
    if (!Number.isInteger(n) || n < 1) {
      errors.push({ field: 'limit', message: 'limit must be an integer >= 1' });
    } else if (n > MAX_LIMIT) {
      errors.push({ field: 'limit', message: `limit must not exceed ${MAX_LIMIT}` });
    } else {
      limit = n;
    }
  }

  if (errors.length > 0) {
    return { errors, data: null };
  }

  // Build the Prisma where filter — only include keys that were supplied.
  const filter = {};
  if (status    !== undefined) filter.status    = status;
  if (riskLevel !== undefined) filter.riskLevel = riskLevel;

  return { errors: [], data: { filter, page, limit } };
}

module.exports = { validateCreateChange, validateListChanges };
