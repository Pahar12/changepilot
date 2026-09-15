'use strict';

/**
 * src/ai/schema.js — the structured AI output contract and its validation layer.
 *
 * Nothing downstream of a provider is ever trusted. Every field a provider
 * returns is parsed and checked here before it is allowed to reach the
 * database or an HTTP response.
 *
 * validateAssessment() never repairs invalid input. A single invalid field
 * fails the whole assessment — callers must treat the analysis as failed and
 * respond safely (see aiAnalysisService), not attempt to coerce partial data
 * into something plausible.
 */

const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const RECOMMENDATIONS = ['APPROVE', 'CONDITIONAL_APPROVAL', 'REQUEST_MORE_EVIDENCE', 'REJECT'];

// Fields a provider is required to return. Anything else in the raw object
// is ignored (not copied into `data`) rather than rejected, so a provider
// that adds harmless extra metadata doesn't fail validation outright — but
// none of that extra data is ever persisted or trusted.
const REQUIRED_FIELDS = [
  'riskLevel',
  'riskScore',
  'confidence',
  'summary',
  'affectedAreas',
  'riskFactors',
  'missingEvidence',
  'recommendation'
];

const MAX_SUMMARY_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_ITEM_LENGTH = 500;

/**
 * Validate that a value is an array of non-empty strings, each within a
 * reasonable length, and the array itself within a reasonable size.
 *
 * @param {*} value
 * @returns {{ ok: boolean, message?: string, data?: string[] }}
 */
function validateStringArray(value) {
  if (!Array.isArray(value)) {
    return { ok: false, message: 'must be an array of strings' };
  }
  if (value.length > MAX_ARRAY_ITEMS) {
    return { ok: false, message: `must not exceed ${MAX_ARRAY_ITEMS} items` };
  }
  const data = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return { ok: false, message: 'every item must be a non-empty string' };
    }
    if (item.length > MAX_STRING_ITEM_LENGTH) {
      return { ok: false, message: `every item must not exceed ${MAX_STRING_ITEM_LENGTH} characters` };
    }
    data.push(item.trim());
  }
  return { ok: true, data };
}

/**
 * Validate a single structured risk finding.
 *
 * Kept deliberately small: a description and a severity. Anything else a
 * provider includes on a finding is dropped, not persisted.
 *
 * @param {*} finding
 * @returns {{ ok: boolean, message?: string, data?: Object }}
 */
function validateRiskFactor(finding) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    return { ok: false, message: 'each riskFactor must be an object' };
  }
  if (typeof finding.description !== 'string' || finding.description.trim().length === 0) {
    return { ok: false, message: 'each riskFactor requires a non-empty "description" string' };
  }
  if (finding.description.length > MAX_STRING_ITEM_LENGTH) {
    return { ok: false, message: `riskFactor description must not exceed ${MAX_STRING_ITEM_LENGTH} characters` };
  }
  if (!RISK_LEVELS.includes(finding.severity)) {
    return { ok: false, message: `each riskFactor requires "severity" to be one of: ${RISK_LEVELS.join(', ')}` };
  }
  return {
    ok: true,
    data: { description: finding.description.trim(), severity: finding.severity }
  };
}

/**
 * Validate an array of structured risk findings.
 *
 * @param {*} value
 * @returns {{ ok: boolean, message?: string, data?: Object[] }}
 */
function validateRiskFactors(value) {
  if (!Array.isArray(value)) {
    return { ok: false, message: 'must be an array of structured findings' };
  }
  if (value.length > MAX_ARRAY_ITEMS) {
    return { ok: false, message: `must not exceed ${MAX_ARRAY_ITEMS} items` };
  }
  const data = [];
  for (const finding of value) {
    const result = validateRiskFactor(finding);
    if (!result.ok) {
      return result;
    }
    data.push(result.data);
  }
  return { ok: true, data };
}

/**
 * Validate a raw AI provider response against the ChangePilot structured
 * assessment contract.
 *
 * Business validation rules enforced here (in addition to type/shape checks):
 *   - riskScore must be an integer in [0, 100]
 *   - confidence must be a number in [0, 1]
 *   - riskLevel must be a known enum value
 *   - recommendation must be a known enum value
 *   - all required fields must be present
 *
 * Invalid input is never repaired — the first failing field is reported and
 * the assessment as a whole is rejected.
 *
 * @param {*} raw - parsed JSON object returned by an AI provider
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}>, data: Object|null }}
 */
function validateAssessment(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [{ field: 'root', message: 'AI response must be a JSON object' }],
      data: null
    };
  }

  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) {
      errors.push({ field, message: `${field} is required` });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  const data = {};

  // ── riskLevel ────────────────────────────────────────────────────────────
  if (!RISK_LEVELS.includes(raw.riskLevel)) {
    errors.push({ field: 'riskLevel', message: `riskLevel must be one of: ${RISK_LEVELS.join(', ')}` });
  } else {
    data.riskLevel = raw.riskLevel;
  }

  // ── riskScore ────────────────────────────────────────────────────────────
  if (!Number.isInteger(raw.riskScore) || raw.riskScore < 0 || raw.riskScore > 100) {
    errors.push({ field: 'riskScore', message: 'riskScore must be an integer between 0 and 100' });
  } else {
    data.riskScore = raw.riskScore;
  }

  // ── confidence ───────────────────────────────────────────────────────────
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    errors.push({ field: 'confidence', message: 'confidence must be a number between 0 and 1' });
  } else {
    data.confidence = raw.confidence;
  }

  // ── summary ──────────────────────────────────────────────────────────────
  if (typeof raw.summary !== 'string' || raw.summary.trim().length === 0) {
    errors.push({ field: 'summary', message: 'summary must be a non-empty string' });
  } else if (raw.summary.length > MAX_SUMMARY_LENGTH) {
    errors.push({ field: 'summary', message: `summary must not exceed ${MAX_SUMMARY_LENGTH} characters` });
  } else {
    data.summary = raw.summary.trim();
  }

  // ── affectedAreas ────────────────────────────────────────────────────────
  const affectedAreasResult = validateStringArray(raw.affectedAreas);
  if (!affectedAreasResult.ok) {
    errors.push({ field: 'affectedAreas', message: `affectedAreas ${affectedAreasResult.message}` });
  } else {
    data.affectedAreas = affectedAreasResult.data;
  }

  // ── riskFactors ──────────────────────────────────────────────────────────
  const riskFactorsResult = validateRiskFactors(raw.riskFactors);
  if (!riskFactorsResult.ok) {
    errors.push({ field: 'riskFactors', message: `riskFactors ${riskFactorsResult.message}` });
  } else {
    data.riskFactors = riskFactorsResult.data;
  }

  // ── missingEvidence ──────────────────────────────────────────────────────
  const missingEvidenceResult = validateStringArray(raw.missingEvidence);
  if (!missingEvidenceResult.ok) {
    errors.push({ field: 'missingEvidence', message: `missingEvidence ${missingEvidenceResult.message}` });
  } else {
    data.missingEvidence = missingEvidenceResult.data;
  }

  // ── recommendation ───────────────────────────────────────────────────────
  if (!RECOMMENDATIONS.includes(raw.recommendation)) {
    errors.push({ field: 'recommendation', message: `recommendation must be one of: ${RECOMMENDATIONS.join(', ')}` });
  } else {
    data.recommendation = raw.recommendation;
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  return { valid: true, errors: [], data };
}

module.exports = {
  RISK_LEVELS,
  RECOMMENDATIONS,
  validateAssessment
};
