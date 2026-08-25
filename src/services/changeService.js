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

module.exports = { createChange };
