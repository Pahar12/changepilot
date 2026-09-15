'use strict';

/**
 * evidenceService.js — business logic for the Evidence resource.
 *
 * Same conventions as changeService.js: pure business logic, Prisma calls,
 * plain Error objects tagged with .statusCode for the controller to map to
 * HTTP responses. No Express, no req/res.
 *
 * Ownership model (mirrors changeService.js exactly — no new RBAC design):
 *   - REQUESTER may create/view evidence only on ChangeRequests they created
 *     (ChangeRequest.createdById === user.id).
 *   - REVIEWER and ADMIN may view any ChangeRequest's evidence, matching the
 *     existing convention that approve/reject/close are REVIEWER/ADMIN-only
 *     and unrestricted by ownership.
 *   - Only REQUESTER and ADMIN may create evidence (see evidenceRoutes.js /
 *     changeRoutes.js authorize() call) — the same role split already used
 *     for POST /api/v1/changes.
 *
 * submittedById is ALWAYS derived from the authenticated user, never from
 * client input — see evidenceValidator.js's field allow-list, which is the
 * first line of defence against a client trying to forge ownership.
 */

const prisma = require('../lib/prisma');
const { recordAuditEvent } = require('./auditService');

/**
 * Create a new Evidence record for a ChangeRequest.
 *
 * The Evidence row and its EVIDENCE_CREATED audit event are written in a
 * single Prisma transaction — same reasoning as changeService.js: evidence
 * should never exist without a corresponding audit row.
 *
 * @param {string} changeRequestId - UUID v4
 * @param {Object} fields - sanitised { type, title, description?, reference, metadata? }
 * @param {Object} user - authenticated user { id, role }
 * @returns {Promise<Object>} the created Evidence record
 * @throws {Error} statusCode 401 — no authenticated user
 * @throws {Error} statusCode 404 — ChangeRequest not found
 * @throws {Error} statusCode 403 — REQUESTER creating evidence on someone else's ChangeRequest
 */
async function createEvidence(changeRequestId, fields, user) {
  if (!user || typeof user.id !== 'string') {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  const changeRequest = await prisma.changeRequest.findUnique({ where: { id: changeRequestId } });

  if (!changeRequest) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  if (user.role === 'REQUESTER' && changeRequest.createdById !== user.id) {
    const err = new Error('Forbidden: you can only add evidence to your own change requests');
    err.statusCode = 403;
    throw err;
  }

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.evidence.create({
      data: {
        changeRequestId,
        submittedById: user.id,
        type: fields.type,
        title: fields.title,
        description: fields.description,
        reference: fields.reference,
        metadata: fields.metadata
      }
    });

    await recordAuditEvent(
      {
        actorId: user.id,
        action: 'EVIDENCE_CREATED',
        entityType: 'Evidence',
        entityId: created.id,
        changeRequestId,
        metadata: { type: created.type, title: created.title }
      },
      tx
    );

    return created;
  });

  return record;
}

/**
 * List all Evidence attached to a ChangeRequest, most recent first.
 *
 * @param {string} changeRequestId - UUID v4
 * @param {Object} user - authenticated user { id, role }
 * @returns {Promise<Object[]>} Evidence records
 * @throws {Error} statusCode 401 — no authenticated user
 * @throws {Error} statusCode 404 — ChangeRequest not found
 * @throws {Error} statusCode 403 — REQUESTER viewing someone else's ChangeRequest
 */
async function listEvidenceForChange(changeRequestId, user) {
  if (!user || typeof user.id !== 'string') {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  const changeRequest = await prisma.changeRequest.findUnique({ where: { id: changeRequestId } });

  if (!changeRequest) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  if (user.role === 'REQUESTER' && changeRequest.createdById !== user.id) {
    const err = new Error('Forbidden: you can only view evidence for your own change requests');
    err.statusCode = 403;
    throw err;
  }

  return prisma.evidence.findMany({
    where: { changeRequestId },
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Retrieve a single Evidence record by its own id.
 *
 * Ownership is derived transitively through the parent ChangeRequest — a
 * REQUESTER may only view evidence whose ChangeRequest they own, regardless
 * of who originally submitted the evidence itself.
 *
 * @param {string} evidenceId - UUID v4
 * @param {Object} user - authenticated user { id, role }
 * @returns {Promise<Object>} the Evidence record (without the joined ChangeRequest)
 * @throws {Error} statusCode 401 — no authenticated user
 * @throws {Error} statusCode 404 — Evidence not found
 * @throws {Error} statusCode 403 — REQUESTER viewing evidence on someone else's ChangeRequest
 */
async function getEvidenceById(evidenceId, user) {
  if (!user || typeof user.id !== 'string') {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  const record = await prisma.evidence.findUnique({
    where: { id: evidenceId },
    include: { changeRequest: { select: { createdById: true } } }
  });

  if (!record) {
    const err = new Error('Evidence not found');
    err.statusCode = 404;
    throw err;
  }

  if (user.role === 'REQUESTER' && record.changeRequest.createdById !== user.id) {
    const err = new Error('Forbidden: you can only view evidence for your own change requests');
    err.statusCode = 403;
    throw err;
  }

  // Drop the joined ChangeRequest fields — they were fetched only to
  // resolve ownership and are not part of the Evidence response shape.
  const { changeRequest, ...evidence } = record;
  void changeRequest;
  return evidence;
}

module.exports = { createEvidence, listEvidenceForChange, getEvidenceById };
