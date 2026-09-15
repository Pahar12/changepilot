'use strict';

/**
 * auditService.js — centralized audit-event recording helper.
 *
 * The single write path for every AuditEvent in the application. Callers
 * (changeService.js, evidenceService.js, aiAnalysisService.js) call
 * recordAuditEvent() rather than calling `prisma.auditEvent.create()`
 * directly, so there is exactly one place that shapes the row and one
 * place that guards against secret leakage (see assertSafeMetadata below).
 *
 * Immutability: there is no update/delete path for AuditEvent anywhere in
 * the application layer — this module only ever creates rows, and no
 * controller/route exposes editing or deleting an audit event. That is an
 * application-level guarantee, not a database-level one (see
 * docs/architecture.md for the caveat that direct DB access could still
 * mutate rows — no triggers were added to enforce this at the DB level,
 * per the phase's explicit scope-control guidance).
 *
 * HISTORY: originally added in Phase 1 to record only AI_ANALYSIS_COMPLETED.
 * Phase 3 wired it into changeService.js (create/update/submit/approve/
 * reject/close) and evidenceService.js (create), and added an
 * AI_ANALYSIS_FAILED path — see aiAnalysisService.js.
 */

const prisma = require('../lib/prisma');

// Defence-in-depth: metadata keys whose *name* suggests they might carry a
// secret are refused outright, regardless of caller. This doesn't replace
// callers being careful about what they pass — it exists so a future
// developer who writes `metadata: { password: ... }` (or jwt/token/apiKey/
// authorization/credential) gets a loud failure immediately, in dev/tests,
// rather than a quietly-persisted secret in the audit_events table.
const FORBIDDEN_METADATA_KEY_PATTERN = /password|secret|token|jwt|api[-_]?key|authorization|credential/i;

/**
 * Recursively check metadata for keys that look like they might hold a
 * secret. Throws on the first match; safe to call on any JSON-serializable
 * value (arrays and primitives are simply not object-scanned).
 *
 * @param {*} metadata
 * @param {string} [path]
 * @throws {Error} if a forbidden-looking key is found
 */
function assertSafeMetadata(metadata, path = 'metadata') {
  if (metadata === null || metadata === undefined || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return;
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) {
      throw new Error(
        `auditService: refusing to record metadata field "${path}.${key}" — its name suggests it may contain a secret`
      );
    }
    assertSafeMetadata(value, `${path}.${key}`);
  }
}

/**
 * Record an audit event.
 *
 * Accepts an optional Prisma transaction client (`tx`) so callers can
 * record the audit event atomically alongside the write it documents (see
 * aiAnalysisService, which persists the AIAnalysis row and its audit event
 * in the same transaction).
 *
 * Never accepts or stores secrets: callers must not put API keys, tokens,
 * or credentials in `metadata`.
 *
 * @param {Object} event
 * @param {string}   event.actorId          - user who triggered the event
 * @param {string}   event.action           - e.g. "AI_ANALYSIS_COMPLETED"
 * @param {string}   event.entityType       - e.g. "AIAnalysis"
 * @param {string}   event.entityId         - id of the affected entity
 * @param {string}   [event.changeRequestId] - associated ChangeRequest id
 * @param {Object}   [event.metadata]       - JSON-serializable, secret-free details
 * @param {Object}   [client]               - Prisma client or transaction client (defaults to the shared singleton)
 * @returns {Promise<Object>} the created AuditEvent record
 */
async function recordAuditEvent(event, client = prisma) {
  assertSafeMetadata(event.metadata);

  return client.auditEvent.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      changeRequestId: event.changeRequestId,
      metadata: event.metadata
    }
  });
}

module.exports = { recordAuditEvent };
