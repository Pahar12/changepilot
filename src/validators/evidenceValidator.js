'use strict';

/**
 * evidenceValidator.js — pure input validation for the Evidence resource.
 *
 * Same conventions as changeValidator.js:
 * Returns { errors: Array<{field: string, message: string}>, data: Object|null }.
 * No Express, no Prisma, no side-effects: easy to unit-test.
 */

// Fields the client is permitted to send when creating evidence.
// id, changeRequestId, submittedById, createdAt, updatedAt are all
// server-controlled and must be rejected — changeRequestId comes from the
// URL (:id), and submittedById is always derived from the authenticated
// user (see evidenceService.js), never from the request body. This is the
// primary defence against a client trying to forge ownership by supplying
// createdById/userId/ownerId/submittedById directly.
const ALLOWED_FIELDS = ['type', 'title', 'description', 'reference', 'metadata'];

const TYPE_MAX_LENGTH = 50;
const TITLE_MAX_LENGTH = 150;
const DESCRIPTION_MAX_LENGTH = 2000;
const REFERENCE_MAX_LENGTH = 500;

/**
 * Validate the body of POST /api/v1/changes/:id/evidence.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateCreateEvidence(body) {
  const errors = [];
  const raw = body || {};

  // ── Unknown / forbidden fields ──────────────────────────────────────────
  // Also catches any attempt to smuggle ownership fields (createdById,
  // submittedById, userId, ownerId) through the request body.
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      errors.push({ field: key, message: `Field "${key}" is not permitted` });
    }
  }

  // ── type ─────────────────────────────────────────────────────────────────
  let type;
  if (raw.type === undefined || raw.type === null) {
    errors.push({ field: 'type', message: 'type is required' });
  } else if (typeof raw.type !== 'string') {
    errors.push({ field: 'type', message: 'type must be a string' });
  } else {
    type = raw.type.trim();
    if (type.length === 0) {
      errors.push({ field: 'type', message: 'type must not be empty' });
      type = undefined;
    } else if (type.length > TYPE_MAX_LENGTH) {
      errors.push({ field: 'type', message: `type must not exceed ${TYPE_MAX_LENGTH} characters` });
      type = undefined;
    }
  }

  // ── title ────────────────────────────────────────────────────────────────
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
    } else if (title.length > TITLE_MAX_LENGTH) {
      errors.push({ field: 'title', message: `title must not exceed ${TITLE_MAX_LENGTH} characters` });
      title = undefined;
    }
  }

  // ── description (optional) ──────────────────────────────────────────────
  let description;
  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== 'string') {
      errors.push({ field: 'description', message: 'description must be a string' });
    } else {
      description = raw.description.trim();
      if (description.length > DESCRIPTION_MAX_LENGTH) {
        errors.push({ field: 'description', message: `description must not exceed ${DESCRIPTION_MAX_LENGTH} characters` });
      }
    }
  }

  // ── reference ────────────────────────────────────────────────────────────
  // A URL or external reference (e.g. a ticket ID). Deliberately not
  // restricted to URL format — schema comment allows either.
  let reference;
  if (raw.reference === undefined || raw.reference === null) {
    errors.push({ field: 'reference', message: 'reference is required' });
  } else if (typeof raw.reference !== 'string') {
    errors.push({ field: 'reference', message: 'reference must be a string' });
  } else {
    reference = raw.reference.trim();
    if (reference.length === 0) {
      errors.push({ field: 'reference', message: 'reference must not be empty' });
      reference = undefined;
    } else if (reference.length > REFERENCE_MAX_LENGTH) {
      errors.push({ field: 'reference', message: `reference must not exceed ${REFERENCE_MAX_LENGTH} characters` });
      reference = undefined;
    }
  }

  // ── metadata (optional) ─────────────────────────────────────────────────
  // Must be a plain JSON object when supplied — not an array, not a
  // primitive. Contents are opaque/free-form; not deep-validated here.
  let metadata;
  if (raw.metadata !== undefined && raw.metadata !== null) {
    if (typeof raw.metadata !== 'object' || Array.isArray(raw.metadata)) {
      errors.push({ field: 'metadata', message: 'metadata must be a JSON object' });
    } else {
      metadata = raw.metadata;
    }
  }

  if (errors.length > 0) {
    return { errors, data: null };
  }

  return {
    errors: [],
    data: {
      type,
      title,
      ...(description !== undefined && { description }),
      reference,
      ...(metadata !== undefined && { metadata })
    }
  };
}

// UUID v4 format — identical pattern to changeValidator.validateChangeId.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate the :id route parameter for routes that accept an Evidence id.
 *
 * @param {string} id - raw req.params.id
 * @returns {{ errors: Array<{field:string, message:string}>, data: string|null }}
 */
function validateEvidenceId(id) {
  if (!id || !UUID_V4_RE.test(id)) {
    return {
      errors: [{ field: 'id', message: 'id must be a valid UUID' }],
      data: null
    };
  }
  return { errors: [], data: id };
}

module.exports = {
  validateCreateEvidence,
  validateEvidenceId
};
