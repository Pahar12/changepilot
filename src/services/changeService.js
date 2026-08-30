'use strict';

/**
 * changeService.js — business logic for the ChangeRequest resource.
 *
 * Responsibilities:
 *   - Apply business rules (status is always DRAFT on creation)
 *   - Interact with Prisma to persist data
 *   - Throw plain Error objects for domain failures (not HTTP constructs)
 *
 * This module knows nothing about Express, req, or res.
 */

const prisma = require('../lib/prisma');

/**
 * Create a new ChangeRequest.
 *
 * Business rules enforced here (not by the caller):
 *   - status is always DRAFT — clients cannot influence the initial lifecycle state
 *   - riskLevel defaults to LOW when omitted — Prisma schema default covers this,
 *     but being explicit here makes the rule visible to future maintainers
 *   - createdById is populated from the authenticated user context
 *
 * @param {Object} fields
 * @param {string}  fields.title
 * @param {string}  [fields.description]
 * @param {string}  [fields.riskLevel]   - LOW | MEDIUM | HIGH | CRITICAL
 * @param {string}  createdById          - authenticated user UUID
 * @returns {Promise<Object>} the created ChangeRequest record
 */
async function createChange(fields, createdById) {
  if (typeof createdById !== 'string' || createdById.length === 0) {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  const record = await prisma.changeRequest.create({
    data: {
      title:       fields.title,
      description: fields.description,      // undefined → Prisma omits field (nullable, stays null)
      riskLevel:   fields.riskLevel,        // undefined → Prisma uses schema default (LOW)
      status:      'DRAFT',                 // always overridden — client cannot set this
      createdById                         // set from authenticated user
    }
  });

  return record;
}

/**
 * List ChangeRequests with optional filtering and offset pagination.
 *
 * Runs findMany and count in parallel — both use the same where filter so
 * only one set of query parameters is constructed.
 *
 * @param {Object} options
 * @param {Object}  options.filter  - Prisma where clause (may be {})
 * @param {number}  options.page    - 1-based page number
 * @param {number}  options.limit   - records per page
 * @returns {Promise<{ data: Object[], pagination: Object }>}
 */
async function listChanges({ filter, page, limit }) {
  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    prisma.changeRequest.findMany({
      where:   filter,
      orderBy: { createdAt: 'desc' },
      skip,
      take:    limit
    }),
    prisma.changeRequest.count({ where: filter })
  ]);

  return {
    data: records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0
    }
  };
}

/**
 * Retrieve a single ChangeRequest by its UUID.
 *
 * Returns the record when found.
 * Throws a plain Error tagged with statusCode 404 when no record matches.
 * The controller catches errors by their statusCode tag and maps them to the
 * correct HTTP response; anything without a recognised statusCode is re-thrown
 * to the global error handler (500).
 *
 * @param {string} id - UUID v4
 * @returns {Promise<Object>} the ChangeRequest record
 * @throws {Error} with statusCode 404 when not found
 */
async function getChangeById(id) {
  const record = await prisma.changeRequest.findUnique({ where: { id } });

  if (!record) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  return record;
}

/**
 * Submit a ChangeRequest: transition from DRAFT → UNDER_REVIEW.
 *
 * Business rules enforced here:
 *   1. The record must exist (404 if not).
 *   2. The record must be in DRAFT status (409 if not).
 *   3. The record's stored description must be non-null and non-blank (400 if not).
 *   4. The resulting status is always UNDER_REVIEW — the caller cannot influence it.
 *
 * Race-condition handling:
 *   The transition uses updateMany() with a compound WHERE clause (id AND status=DRAFT).
 *   This makes the state-check and the write a single atomic database operation —
 *   two concurrent submit requests against the same DRAFT record will each issue the
 *   same UPDATE; exactly one will match (count=1) and the other will get count=0,
 *   triggering the diagnostic follow-up without either request seeing a corrupt state.
 *
 *   The follow-up findUnique only runs in the count=0 path (failure path).
 *   On the success path (count=1) a single extra findUnique fetches the updated record.
 *
 * @param {string} id   - UUID v4
 * @param {Object} [user] - authenticated user object { id, role }
 * @returns {Promise<Object>} the updated ChangeRequest record
 * @throws {Error} statusCode 404 — record not found
 * @throws {Error} statusCode 403 — requester modifying someone else's request
 * @throws {Error} statusCode 409 — record exists but is not DRAFT
 * @throws {Error} statusCode 400 — record is DRAFT but description is blank
 */
async function submitChange(id, user) {
  if (!user || typeof user.id !== 'string') {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  // ── Step 1: Read the current record so we can enforce pre-conditions ─────────
  // We must know the description before attempting the update — it's stored in
  // the DB and cannot be validated from the request body.
  const current = await prisma.changeRequest.findUnique({ where: { id } });

  if (!current) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  // ── Ownership check for REQUESTER role ────────────────────────────────────
  if (user.role === 'REQUESTER' && current.createdById !== user.id) {
    const err = new Error('Forbidden: you can only submit your own change requests');
    err.statusCode = 403;
    throw err;
  }

  if (current.status !== 'DRAFT') {
    const err = new Error('Change request cannot be submitted from its current status');
    err.statusCode = 409;
    throw err;
  }

  // ── Step 2: Enforce description pre-condition ─────────────────────────────
  const description = current.description ? current.description.trim() : '';
  if (description.length === 0) {
    const err = new Error('description is required before submitting for review');
    err.statusCode = 400;
    throw err;
  }

  // ── Step 3: Atomic conditional update ─────────────────────────────────────
  // WHERE id=X AND status=DRAFT ensures we only update a record that is still
  // DRAFT at write time, closing the window between Step 1 and Step 3.
  // If a concurrent request already transitioned the record, count will be 0.
  const { count } = await prisma.changeRequest.updateMany({
    where: { id, status: 'DRAFT' },
    data:  { status: 'UNDER_REVIEW' }
  });

  if (count === 0) {
    // Another concurrent request won the race and already transitioned this record.
    const err = new Error('Change request cannot be submitted from its current status');
    err.statusCode = 409;
    throw err;
  }

  // ── Step 4: Fetch and return the updated record ───────────────────────────
  return prisma.changeRequest.findUnique({ where: { id } });
}

/**
 * Approve a ChangeRequest: transition from UNDER_REVIEW → APPROVED.
 *
 * Business rules:
 *   1. The record must exist (404 if not).
 *   2. The record must be UNDER_REVIEW (409 if not).
 *   3. Atomic conditional update guards against concurrent transitions.
 *
 * @param {string} id - UUID v4
 * @returns {Promise<Object>} the updated ChangeRequest record
 * @throws {Error} statusCode 404 — record not found
 * @throws {Error} statusCode 409 — record is not UNDER_REVIEW
 */
async function approveChange(id) {
  const current = await prisma.changeRequest.findUnique({ where: { id } });

  if (!current) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  if (current.status !== 'UNDER_REVIEW') {
    const err = new Error('Change request cannot be approved from its current status');
    err.statusCode = 409;
    throw err;
  }

  const { count } = await prisma.changeRequest.updateMany({
    where: { id, status: 'UNDER_REVIEW' },
    data:  { status: 'APPROVED' }
  });

  if (count === 0) {
    const err = new Error('Change request cannot be approved from its current status');
    err.statusCode = 409;
    throw err;
  }

  return prisma.changeRequest.findUnique({ where: { id } });
}

/**
 * Reject a ChangeRequest: transition from UNDER_REVIEW → REJECTED.
 *
 * Business rules:
 *   1. The record must exist (404 if not).
 *   2. The record must be UNDER_REVIEW (409 if not).
 *   3. Atomic conditional update guards against concurrent transitions.
 *
 * @param {string} id - UUID v4
 * @returns {Promise<Object>} the updated ChangeRequest record
 * @throws {Error} statusCode 404 — record not found
 * @throws {Error} statusCode 409 — record is not UNDER_REVIEW
 */
async function rejectChange(id) {
  const current = await prisma.changeRequest.findUnique({ where: { id } });

  if (!current) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  if (current.status !== 'UNDER_REVIEW') {
    const err = new Error('Change request cannot be rejected from its current status');
    err.statusCode = 409;
    throw err;
  }

  const { count } = await prisma.changeRequest.updateMany({
    where: { id, status: 'UNDER_REVIEW' },
    data:  { status: 'REJECTED' }
  });

  if (count === 0) {
    const err = new Error('Change request cannot be rejected from its current status');
    err.statusCode = 409;
    throw err;
  }

  return prisma.changeRequest.findUnique({ where: { id } });
}

/**
 * Close a ChangeRequest: transition from APPROVED or REJECTED → CLOSED.
 *
 * Business rules:
 *   1. The record must exist (404 if not).
 *   2. The record must be APPROVED or REJECTED (409 if not).
 *   3. Atomic conditional update guards against concurrent transitions.
 *
 * @param {string} id - UUID v4
 * @returns {Promise<Object>} the updated ChangeRequest record
 * @throws {Error} statusCode 404 — record not found
 * @throws {Error} statusCode 409 — record is not APPROVED or REJECTED
 */
async function closeChange(id) {
  const current = await prisma.changeRequest.findUnique({ where: { id } });

  if (!current) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  if (current.status !== 'APPROVED' && current.status !== 'REJECTED') {
    const err = new Error('Change request cannot be closed from its current status');
    err.statusCode = 409;
    throw err;
  }

  const { count } = await prisma.changeRequest.updateMany({
    where: { id, status: { in: ['APPROVED', 'REJECTED'] } },
    data:  { status: 'CLOSED' }
  });

  if (count === 0) {
    const err = new Error('Change request cannot be closed from its current status');
    err.statusCode = 409;
    throw err;
  }

  return prisma.changeRequest.findUnique({ where: { id } });
}

/**
 * Update editable fields of a DRAFT ChangeRequest.
 *
 * Business rules enforced here:
 *   1. The record must exist (404 if not).
 *   2. The record must be in DRAFT status (409 if not).
 *   3. Only title, description, and riskLevel may be changed — status is never
 *      touched by this function regardless of what the caller passes.
 *   4. Atomic conditional update (WHERE id AND status=DRAFT) guards against a
 *      concurrent submit/approve/reject/close that races with this write.
 *
 * PATCH semantics: only keys present in `fields` are written. A key being absent
 * means "leave as-is"; an explicit undefined would be excluded by the spread in
 * the validator so it never reaches here.
 *
 * @param {string} id     - UUID v4
 * @param {Object} fields - sanitised subset of { title, description, riskLevel }
 * @param {Object} [user] - authenticated user object { id, role }
 * @returns {Promise<Object>} the updated ChangeRequest record
 * @throws {Error} statusCode 404 — record not found
 * @throws {Error} statusCode 403 — requester modifying someone else's request
 * @throws {Error} statusCode 409 — record is not DRAFT
 */
async function updateChange(id, fields, user) {
  if (!user || typeof user.id !== 'string') {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  // ── Step 1: Read current record to enforce pre-conditions ──────────────────
  const current = await prisma.changeRequest.findUnique({ where: { id } });

  if (!current) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  // ── Ownership check for REQUESTER role ────────────────────────────────────
  if (user.role === 'REQUESTER' && current.createdById !== user.id) {
    const err = new Error('Forbidden: you can only edit your own change requests');
    err.statusCode = 403;
    throw err;
  }

  if (current.status !== 'DRAFT') {
    const err = new Error('Change request cannot be edited from its current status');
    err.statusCode = 409;
    throw err;
  }

  // ── Step 2: Atomic conditional update ─────────────────────────────────────
  // WHERE id=X AND status=DRAFT closes the race window between Step 1 and now.
  // If a concurrent submit/approve won the race, count will be 0.
  //
  // Defence-in-depth: explicitly allow only the three editable fields into the
  // Prisma data object. The validator already strips everything else, but this
  // service layer is the last line of defence — it must not blindly spread
  // caller-supplied keys in case updateChange is ever called directly (e.g.
  // from a future script or test) without going through the HTTP middleware.
  const safeData = {};
  if (fields.title       !== undefined) safeData.title       = fields.title;
  if (fields.description !== undefined) safeData.description = fields.description;
  if (fields.riskLevel   !== undefined) safeData.riskLevel   = fields.riskLevel;

  const { count } = await prisma.changeRequest.updateMany({
    where: { id, status: 'DRAFT' },
    data:  safeData
  });

  if (count === 0) {
    // A concurrent transition already moved this record out of DRAFT.
    const err = new Error('Change request cannot be edited from its current status');
    err.statusCode = 409;
    throw err;
  }

  // ── Step 3: Return the updated record ─────────────────────────────────────
  return prisma.changeRequest.findUnique({ where: { id } });
}

module.exports = { createChange, listChanges, getChangeById, submitChange, approveChange, rejectChange, closeChange, updateChange };
