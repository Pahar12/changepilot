'use strict';

/**
 * tests/ai.schema.test.js
 *
 * Pure unit tests for src/ai/schema.js — validateAssessment().
 *
 * No database, no HTTP server, no AI provider, no network. These tests
 * exercise the validation boundary in isolation and can run anywhere,
 * including sandboxes where the Prisma Query Engine is unavailable.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { validateAssessment } = require('../src/ai/schema');

function validAssessment(overrides = {}) {
  return {
    riskLevel: 'MEDIUM',
    riskScore: 42,
    confidence: 0.75,
    summary: 'A reasonably risky change.',
    affectedAreas: ['billing', 'auth'],
    riskFactors: [{ description: 'Touches the payments table', severity: 'HIGH' }],
    missingEvidence: ['Rollback plan'],
    recommendation: 'CONDITIONAL_APPROVAL',
    ...overrides
  };
}

describe('validateAssessment — valid input', () => {
  test('a fully valid assessment passes and echoes sanitised data', () => {
    const { valid, errors, data } = validateAssessment(validAssessment());
    assert.equal(valid, true);
    assert.deepEqual(errors, []);
    assert.equal(data.riskLevel, 'MEDIUM');
    assert.equal(data.riskScore, 42);
    assert.equal(data.confidence, 0.75);
    assert.equal(data.recommendation, 'CONDITIONAL_APPROVAL');
    assert.deepEqual(data.affectedAreas, ['billing', 'auth']);
    assert.deepEqual(data.riskFactors, [{ description: 'Touches the payments table', severity: 'HIGH' }]);
  });

  test('boundary values riskScore=0 and riskScore=100 are accepted', () => {
    assert.equal(validateAssessment(validAssessment({ riskScore: 0 })).valid, true);
    assert.equal(validateAssessment(validAssessment({ riskScore: 100 })).valid, true);
  });

  test('boundary values confidence=0 and confidence=1 are accepted', () => {
    assert.equal(validateAssessment(validAssessment({ confidence: 0 })).valid, true);
    assert.equal(validateAssessment(validAssessment({ confidence: 1 })).valid, true);
  });

  test('empty affectedAreas/riskFactors/missingEvidence arrays are accepted', () => {
    const { valid } = validateAssessment(
      validAssessment({ affectedAreas: [], riskFactors: [], missingEvidence: [] })
    );
    assert.equal(valid, true);
  });

  test('summary and array strings are trimmed', () => {
    const { data } = validateAssessment(
      validAssessment({ summary: '  padded summary  ', affectedAreas: ['  billing  '] })
    );
    assert.equal(data.summary, 'padded summary');
    assert.deepEqual(data.affectedAreas, ['billing']);
  });
});

describe('validateAssessment — root shape', () => {
  test('null is rejected', () => {
    const { valid, errors } = validateAssessment(null);
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
  });

  test('a string is rejected', () => {
    const { valid } = validateAssessment('not an object');
    assert.equal(valid, false);
  });

  test('an array is rejected', () => {
    const { valid } = validateAssessment([]);
    assert.equal(valid, false);
  });
});

describe('validateAssessment — required fields', () => {
  for (const field of [
    'riskLevel',
    'riskScore',
    'confidence',
    'summary',
    'affectedAreas',
    'riskFactors',
    'missingEvidence',
    'recommendation'
  ]) {
    test(`missing "${field}" is rejected`, () => {
      const input = validAssessment();
      delete input[field];
      const { valid, errors, data } = validateAssessment(input);
      assert.equal(valid, false);
      assert.equal(data, null);
      assert.ok(errors.some((e) => e.field === field));
    });
  }
});

describe('validateAssessment — business rules', () => {
  test('riskScore > 100 is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ riskScore: 101 }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskScore'));
  });

  test('riskScore < 0 is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ riskScore: -1 }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskScore'));
  });

  test('non-integer riskScore is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ riskScore: 42.5 }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskScore'));
  });

  test('confidence > 1 is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ confidence: 1.1 }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'confidence'));
  });

  test('confidence < 0 is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ confidence: -0.1 }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'confidence'));
  });

  test('unknown riskLevel is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ riskLevel: 'EXTREME' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskLevel'));
  });

  test('lowercase riskLevel is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ riskLevel: 'medium' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskLevel'));
  });

  test('unknown recommendation is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ recommendation: 'AUTO_MERGE' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'recommendation'));
  });

  test('empty summary is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ summary: '   ' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'summary'));
  });

  test('non-string summary is rejected', () => {
    const { valid, errors } = validateAssessment(validAssessment({ summary: 12345 }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'summary'));
  });

  test('affectedAreas must be an array', () => {
    const { valid, errors } = validateAssessment(validAssessment({ affectedAreas: 'billing' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'affectedAreas'));
  });

  test('affectedAreas rejects non-string items', () => {
    const { valid, errors } = validateAssessment(validAssessment({ affectedAreas: [123] }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'affectedAreas'));
  });

  test('missingEvidence must be an array of strings', () => {
    const { valid, errors } = validateAssessment(validAssessment({ missingEvidence: [null] }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'missingEvidence'));
  });

  test('riskFactors must be an array', () => {
    const { valid, errors } = validateAssessment(validAssessment({ riskFactors: 'not an array' }));
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskFactors'));
  });

  test('riskFactors items require a non-empty description', () => {
    const { valid, errors } = validateAssessment(
      validAssessment({ riskFactors: [{ description: '', severity: 'LOW' }] })
    );
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskFactors'));
  });

  test('riskFactors items require a valid severity enum', () => {
    const { valid, errors } = validateAssessment(
      validAssessment({ riskFactors: [{ description: 'ok', severity: 'EXTREME' }] })
    );
    assert.equal(valid, false);
    assert.ok(errors.some((e) => e.field === 'riskFactors'));
  });

  test('multiple invalid fields are all reported together', () => {
    const { valid, errors } = validateAssessment(
      validAssessment({ riskScore: 999, confidence: 5, riskLevel: 'BAD', recommendation: 'BAD' })
    );
    assert.equal(valid, false);
    assert.ok(errors.length >= 4);
  });

  test('invalid input is never partially repaired — data is null on failure', () => {
    const { data } = validateAssessment(validAssessment({ riskScore: 999 }));
    assert.equal(data, null);
  });
});
