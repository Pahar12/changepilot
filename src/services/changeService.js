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
 *
 * @param {Object} fields
 * @param {string}  fields.title
 * @param {string}  [fields.description]
 * @param {string}  [fields.riskLevel]  - LOW | MEDIUM | HIGH | CRITICAL
 * @returns {Promise<Object>} the created ChangeRequest record
 */
async function createChange(fields) {
  const record = await prisma.changeRequest.create({
    data: {
      title:       fields.title,
      description: fields.description,      // undefined → Prisma omits field (nullable, stays null)
      riskLevel:   fields.riskLevel,        // undefined → Prisma uses schema default (LOW)
      status:      'DRAFT'                  // always overridden — client cannot set this
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
 * Throws a plain Error with statusCode 404 when no record matches —
 * the global error handler in app.js does NOT recognise statusCode, so the
 * controller must handle this case explicitly and send its own 404 response.
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

module.exports = { createChange, listChanges, getChangeById };
