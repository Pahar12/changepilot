'use strict';

/**
 * aiAnalysisService.js — business logic for AI-assisted, Evidence-aware
 * ChangeRequest analysis.
 *
 * Pipeline (see docs/architecture.md for the full write-up):
 *
 *   ChangeRequest + Evidence (scoped via evidenceService.listEvidenceForChange)
 *     -> promptBuilder.buildAnalysisInput   (allow-listed, sanitized input)
 *     -> AiProvider#analyze                 (vendor-specific, swappable)
 *     -> schema.validateAssessment          (never trust raw model output)
 *     -> Prisma transaction: AIAnalysis + AuditEvent
 *
 * Security invariants enforced here:
 *   - The AI never mutates a ChangeRequest and never approves/rejects one.
 *     This function only ever *creates* an AIAnalysis row; it has no path
 *     to change ChangeRequest.status, and no path to modify Evidence.
 *   - Evidence is strictly scoped to changeRequestId — there is no
 *     evidence-id parameter anywhere in this flow for a client to
 *     manipulate, so evidence from a different ChangeRequest can never be
 *     pulled into an analysis.
 *   - Evidence is treated as untrusted, user-submitted context, not
 *     instructions — see providers/openaiProvider.js's prompt framing and
 *     providers/fakeProvider.js's keyword-matching-only logic.
 *   - Ownership/authorization mirrors the existing conventions in
 *     changeService.js (REQUESTER limited to their own records; REVIEWER
 *     and ADMIN unrestricted) rather than inventing a new authorization
 *     model for AI-specific actions.
 *   - Provider failures and invalid provider output both fail safely
 *     (502, nothing persisted) rather than being silently repaired or
 *     defaulted.
 *
 * This module knows nothing about Express, req, or res — same convention
 * as changeService.js.
 */

const prisma = require('../lib/prisma');
const { getProvider } = require('../ai');
const { buildAnalysisInput } = require('../ai/promptBuilder');
const { validateAssessment } = require('../ai/schema');
const { recordAuditEvent } = require('./auditService');
const evidenceService = require('./evidenceService');

/**
 * Record an AI_ANALYSIS_FAILED audit event. Best-effort: swallows its own
 * errors so a problem recording the failure never masks the original 502
 * response to the client. No AIAnalysis row exists on this path (nothing
 * was persisted), so this is a plain create, not part of a transaction.
 *
 * @param {string} actorId
 * @param {string} changeRequestId
 * @param {Object} metadata - fixed-shape, secret-free (see call sites)
 */
async function recordFailureAudit(actorId, changeRequestId, metadata) {
  try {
    await recordAuditEvent({
      actorId,
      action: 'AI_ANALYSIS_FAILED',
      entityType: 'ChangeRequest',
      entityId: changeRequestId,
      changeRequestId,
      metadata
    });
  } catch (auditErr) {
    console.error('[error] failed to record AI_ANALYSIS_FAILED audit event', auditErr);
  }
}

/**
 * Analyze a ChangeRequest with the configured (or injected) AI provider and
 * persist the resulting structured assessment.
 *
 * @param {string} changeRequestId - UUID v4
 * @param {Object} user            - authenticated user object { id, role }
 * @param {Object} [options]
 * @param {{identifier: string, analyze: Function}} [options.provider] - injected provider (tests use this to pass a fake provider; production code omits it and gets the configured provider from src/ai)
 * @returns {Promise<Object>} the created AIAnalysis record
 * @throws {Error} statusCode 401 — no authenticated user
 * @throws {Error} statusCode 404 — ChangeRequest not found
 * @throws {Error} statusCode 403 — REQUESTER analyzing someone else's ChangeRequest
 * @throws {Error} statusCode 502 — AI provider failed, or returned an invalid structured assessment (see err.errors)
 */
async function analyzeChangeRequest(changeRequestId, user, options = {}) {
  if (!user || typeof user.id !== 'string') {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  // ── Step 1: load + authorize ────────────────────────────────────────────
  const changeRequest = await prisma.changeRequest.findUnique({ where: { id: changeRequestId } });

  if (!changeRequest) {
    const err = new Error('Change request not found');
    err.statusCode = 404;
    throw err;
  }

  // Ownership check mirrors changeService.submitChange/updateChange: a
  // REQUESTER may only analyze their own change requests. REVIEWER and
  // ADMIN follow the existing unrestricted convention for those roles.
  if (user.role === 'REQUESTER' && changeRequest.createdById !== user.id) {
    const err = new Error('Forbidden: you can only analyze your own change requests');
    err.statusCode = 403;
    throw err;
  }

  // ── Step 2: retrieve Evidence + build sanitized provider input ──────────
  // Reuses evidenceService.listEvidenceForChange rather than duplicating the
  // query here — it already scopes strictly to this changeRequestId (a
  // client can never cause evidence from a *different* ChangeRequest to be
  // pulled in; there is no evidence-id input to this function at all, only
  // changeRequestId) and re-applies the same ownership rule this function
  // just checked above. buildAnalysisInput() is still the one place that
  // decides which Evidence *fields* leave the application — evidenceService
  // returns full Evidence records (id, submittedById, timestamps, etc.),
  // and only promptBuilder.js's explicit allow-list determines what of that
  // actually reaches the AI provider.
  const evidence = await evidenceService.listEvidenceForChange(changeRequestId, user);

  const input = buildAnalysisInput(changeRequest, evidence);

  // ── Step 3: call the provider ────────────────────────────────────────────
  const provider = options.provider || getProvider();

  let rawAssessment;
  try {
    rawAssessment = await provider.analyze(input);
  } catch (cause) {
    // Record the failure — but a logging problem here must never hide the
    // real 502 from the client, so audit writes on this path are best-effort
    // and swallow their own errors. Metadata is a fixed, safe string, never
    // the raw provider error text (which could echo back unexpected content).
    await recordFailureAudit(user.id, changeRequestId, { reason: 'provider_request_failed' });
    const err = new Error('AI provider request failed');
    err.statusCode = 502;
    err.cause = cause;
    throw err;
  }

  // ── Step 4: validate — never trust raw model output ─────────────────────
  const { valid, errors, data } = validateAssessment(rawAssessment);
  if (!valid) {
    // invalidFields are field names from schema.js's fixed enum (riskLevel,
    // riskScore, ...) — never arbitrary provider-supplied text — so this is
    // safe to record without risking metadata injection.
    await recordFailureAudit(user.id, changeRequestId, {
      reason: 'invalid_ai_output',
      invalidFields: errors.map((e) => e.field)
    });
    const err = new Error('AI provider returned an invalid structured assessment');
    err.statusCode = 502;
    err.errors = errors;
    throw err;
  }

  // ── Step 5: persist analysis + audit event atomically ───────────────────
  // Either both rows are written or neither is — an AIAnalysis row should
  // never exist without a corresponding audit trail entry.
  const analysis = await prisma.$transaction(async (tx) => {
    const created = await tx.aIAnalysis.create({
      data: {
        changeRequestId,
        riskScore: data.riskScore,
        riskLevel: data.riskLevel,
        confidence: data.confidence,
        summary: data.summary,
        affectedAreas: data.affectedAreas,
        riskFactors: data.riskFactors,
        missingEvidence: data.missingEvidence,
        recommendation: data.recommendation,
        providerModel: provider.identifier
      }
    });

    await recordAuditEvent(
      {
        actorId: user.id,
        action: 'AI_ANALYSIS_COMPLETED',
        entityType: 'AIAnalysis',
        entityId: created.id,
        changeRequestId,
        metadata: {
          providerModel: created.providerModel,
          riskLevel: created.riskLevel,
          riskScore: created.riskScore,
          recommendation: created.recommendation,
          analyzedAt: created.createdAt
        }
      },
      tx
    );

    return created;
  });

  return analysis;
}

module.exports = { analyzeChangeRequest };
