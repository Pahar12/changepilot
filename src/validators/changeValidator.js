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

// UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate the :id route parameter for all routes that accept a ChangeRequest id.
 *
 * Rejects values that are not UUID v4 so obviously invalid IDs never reach
 * the database — Prisma would throw a validation error on a malformed UUID
 * anyway, but catching it here keeps the error shape consistent with the
 * rest of the API (400 + errors array) and avoids a round-trip to the DB.
 *
 * @param {string} id - raw req.params.id
 * @returns {{ errors: Array<{field:string, message:string}>, data: string|null }}
 *   data — the validated id string when valid
 */
function validateChangeId(id) {
  if (!id || !UUID_V4_RE.test(id)) {
    return {
      errors: [{ field: 'id', message: 'id must be a valid UUID' }],
      data:   null
    };
  }
  return { errors: [], data: id };
}

/**
 * Validate the body of POST /api/v1/changes/:id/submit.
 *
 * This is a no-body action endpoint — clients must not supply any fields.
 * The body is expected to be absent, null, or an empty object.
 * Reject any supplied fields to prevent clients from attempting to pass
 * data (e.g. a status field) through the submit action.
 *
 * Description readiness is enforced in the service layer against the stored
 * record — it is not a client-supplied field for this endpoint.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateSubmitChange(body) {
  const raw = body || {};
  const keys = Object.keys(raw);

  if (keys.length > 0) {
    return {
      errors: keys.map((key) => ({
        field: key,
        message: `Field "${key}" is not accepted on the submit action`
      })),
      data: null
    };
  }

  return { errors: [], data: {} };
}

/**
 * Validate the body of POST /api/v1/changes/:id/approve.
 *
 * No-body action — any client-supplied field is rejected.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateApproveChange(body) {
  const raw = body || {};
  const keys = Object.keys(raw);

  if (keys.length > 0) {
    return {
      errors: keys.map((key) => ({
        field: key,
        message: `Field "${key}" is not accepted on the approve action`
      })),
      data: null
    };
  }

  return { errors: [], data: {} };
}

/**
 * Validate the body of POST /api/v1/changes/:id/reject.
 *
 * No-body action — any client-supplied field is rejected.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateRejectChange(body) {
  const raw = body || {};
  const keys = Object.keys(raw);

  if (keys.length > 0) {
    return {
      errors: keys.map((key) => ({
        field: key,
        message: `Field "${key}" is not accepted on the reject action`
      })),
      data: null
    };
  }

  return { errors: [], data: {} };
}

/**
 * Validate the body of POST /api/v1/changes/:id/close.
 *
 * No-body action — any client-supplied field is rejected.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateCloseChange(body) {
  const raw = body || {};
  const keys = Object.keys(raw);

  if (keys.length > 0) {
    return {
      errors: keys.map((key) => ({
        field: key,
        message: `Field "${key}" is not accepted on the close action`
      })),
      data: null
    };
  }

  return { errors: [], data: {} };
}

/**
 * Validate the body of PATCH /api/v1/changes/:id.
 *
 * Only title, description and riskLevel may be updated.
 * At least one field must be supplied.
 */
function validateUpdateChange(body) {
  const errors = [];
  const raw = body || {};

  const allowedFields = ['title', 'description', 'riskLevel'];

  // Reject unknown/server-controlled fields.
  for (const key of Object.keys(raw)) {
    if (!allowedFields.includes(key)) {
      errors.push({
        field: key,
        message: `Field "${key}" is not permitted`
      });
    }
  }

  // PATCH requires at least one field.
  if (Object.keys(raw).length === 0) {
    errors.push({
      field: 'body',
      message: 'At least one field must be provided'
    });
  }

  let title;
  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string') {
      errors.push({
        field: 'title',
        message: 'title must be a string'
      });
    } else {
      title = raw.title.trim();

      if (title.length === 0) {
        errors.push({
          field: 'title',
          message: 'title must not be empty'
        });
      } else if (title.length > 100) {
        errors.push({
          field: 'title',
          message: 'title must not exceed 100 characters'
        });
      }
    }
  }

  let description;
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      errors.push({
        field: 'description',
        message: 'description must be a string'
      });
    } else {
      description = raw.description.trim();
    }
  }

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

  if (errors.length > 0) {
    return { errors, data: null };
  }

  return {
    errors: [],
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(riskLevel !== undefined && { riskLevel })
    }
  };
}

module.exports = {
  validateCreateChange,
  validateListChanges,
  validateChangeId,
  validateSubmitChange,
  validateApproveChange,
  validateRejectChange,
  validateCloseChange,
  validateUpdateChange
};
