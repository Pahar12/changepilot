'use strict';

/**
 * src/ai/promptBuilder.js — builds the sanitized input handed to an AI
 * provider for a single ChangeRequest analysis.
 *
 * This is the ONLY place that decides what data leaves ChangePilot and goes
 * to an AI provider. It deliberately allow-lists fields rather than
 * spreading a Prisma record, so a future column added to ChangeRequest or
 * Evidence (a password reset token, a user's email, a JWT, anything) is
 * never accidentally forwarded to a third-party model just because it
 * exists on the record. In particular, Evidence.id, .submittedById, and
 * .changeRequestId are never included — the AI has no use for internal
 * identifiers, and there's no reason to give a third-party API a user id
 * to correlate.
 *
 * Evidence is treated as untrusted, user-submitted context (see
 * providers/openaiProvider.js's prompt framing) — this module's job is
 * only to select *which* fields travel to a provider, not to judge their
 * content. Every field below (including Evidence.description and
 * .metadata) may contain arbitrary user-authored text.
 */

const MAX_EVIDENCE_ITEMS = 25;

/**
 * @param {Object} changeRequest - a ChangeRequest Prisma record
 * @param {Object[]} [evidence]  - Evidence Prisma records scoped to this
 *                                 ChangeRequest (see aiAnalysisService,
 *                                 which sources these via
 *                                 evidenceService.listEvidenceForChange —
 *                                 already scoped/ownership-checked, so this
 *                                 function does not re-filter by
 *                                 changeRequestId itself)
 * @returns {Object} sanitized input suitable for AiProvider#analyze
 */
function buildAnalysisInput(changeRequest, evidence = []) {
  return {
    changeRequest: {
      title:       changeRequest.title,
      description: changeRequest.description || '',
      riskLevel:   changeRequest.riskLevel,
      status:      changeRequest.status
    },
    evidence: evidence.slice(0, MAX_EVIDENCE_ITEMS).map((item) => ({
      type:        item.type,
      title:       item.title,
      description: item.description || '',
      reference:   item.reference,
      ...(item.metadata !== undefined && item.metadata !== null && { metadata: item.metadata })
    }))
  };
}

module.exports = { buildAnalysisInput };
