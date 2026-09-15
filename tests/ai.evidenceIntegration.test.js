'use strict';

/**
 * tests/ai.evidenceIntegration.test.js
 *
 * Integration tests for Phase 4 — Evidence-aware AI analysis via
 * POST /api/v1/changes/:id/analyze, using the default "fake" AI_PROVIDER
 * (see src/config/env.js) so no network access or API key is required.
 *
 * Covers what tests/ai.fakeProvider.test.js and tests/ai.promptBuilder.test.js
 * can't at the unit level: that Evidence actually flows end-to-end from the
 * database, through evidenceService/promptBuilder, into a persisted
 * AIAnalysis — scoped strictly to the right ChangeRequest, without
 * mutating anything it shouldn't.
 *
 * NOTE: DB-dependent, like every other integration test file in this repo —
 * see the project report for the sandbox's Prisma Query Engine limitation.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('dotenv').config();

const app = require('../app');
const prisma = require('../src/lib/prisma');
const { signToken } = require('../src/lib/jwt');
const { hashPassword } = require('../src/lib/crypto');
const env = require('../src/config/env');

// ── HTTP helper ─────────────────────────────────────────────────────────────

function request(server, method, path, payload, token) {
  return new Promise((resolve, reject) => {
    const data = payload !== undefined ? JSON.stringify(payload) : null;
    const addr = server.address();
    const headers = {};

    if (data !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request({ hostname: '127.0.0.1', port: addr.port, path, method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

function analyze(server, changeId, token, body) {
  return request(server, 'POST', `/api/v1/changes/${changeId}/analyze`, body === undefined ? {} : body, token);
}

function addEvidence(server, changeId, evidence, token) {
  return request(server, 'POST', `/api/v1/changes/${changeId}/evidence`, evidence, token);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server;
let requesterUser;
let requesterToken;

before(async () => {
  await prisma.aIAnalysis.deleteMany({});
  await prisma.auditEvent.deleteMany({});
  await prisma.evidence.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');
  requesterUser = await prisma.user.create({
    data: { name: 'Evidence AI Requester', email: 'evidence-ai@test.com', passwordHash, role: 'REQUESTER' }
  });
  requesterToken = signToken({ userId: requesterUser.id, email: requesterUser.email, role: 'REQUESTER' }, env.jwtSecret);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await prisma.$disconnect();
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

async function createChange(title, description) {
  const { body } = await request(server, 'POST', '/api/v1/changes', { title, description }, requesterToken);
  return body.data;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Evidence-aware AI analysis — evidence reaches the AI input', () => {
  test('a risky change with one piece of reassuring evidence scores lower than the same change with none', async () => {
    const bare = await createChange('Run production database migration', 'Migrate the payment tables');
    const withEvidence = await createChange('Run production database migration', 'Migrate the payment tables');
    await addEvidence(server, withEvidence.id, {
      type: 'ROLLBACK_PLAN',
      title: 'Rollback plan',
      description: 'Documented rollback steps, verified in staging',
      reference: 'https://wiki.example.com/rollback'
    }, requesterToken);

    const bareResult = await analyze(server, bare.id, requesterToken);
    const evidenceResult = await analyze(server, withEvidence.id, requesterToken);

    assert.equal(bareResult.status, 201);
    assert.equal(evidenceResult.status, 201);
    assert.ok(
      evidenceResult.body.data.riskScore < bareResult.body.data.riskScore,
      `expected evidence-backed score (${evidenceResult.body.data.riskScore}) < bare score (${bareResult.body.data.riskScore})`
    );
  });

  test('multiple evidence records are all considered', async () => {
    const change = await createChange('Run production database migration', 'Migrate the auth tables');
    await addEvidence(server, change.id, { type: 'ROLLBACK_PLAN', title: 'Rollback plan', description: 'rollback documented', reference: 'a' }, requesterToken);
    await addEvidence(server, change.id, { type: 'TEST_REPORT', title: 'Test results', description: 'tests passed, dry run completed', reference: 'b' }, requesterToken);
    await addEvidence(server, change.id, { type: 'BACKUP', title: 'Backup confirmation', description: 'backup verified before migration', reference: 'c' }, requesterToken);

    const { status, body } = await analyze(server, change.id, requesterToken);
    assert.equal(status, 201);
    assert.equal(body.data.missingEvidence.length, 0);

    const stored = await prisma.evidence.findMany({ where: { changeRequestId: change.id } });
    assert.equal(stored.length, 3);
  });

  test('zero evidence is handled explicitly, not silently ignored', async () => {
    const change = await createChange('Update marketing copy', 'Fix a typo');
    const { status, body } = await analyze(server, change.id, requesterToken);
    assert.equal(status, 201);
    assert.ok(body.data.missingEvidence.some((m) => /no evidence/i.test(m)));
  });
});

describe('Evidence-aware AI analysis — scoping and isolation', () => {
  test('evidence attached to a different ChangeRequest is never included in this one\'s analysis', async () => {
    const changeA = await createChange('Run production database migration', 'Migrate tables for A');
    const changeB = await createChange('Run production database migration', 'Migrate tables for B');

    // Attach reassuring evidence only to B.
    await addEvidence(server, changeB.id, {
      type: 'ROLLBACK_PLAN', title: 'Rollback plan', description: 'rollback documented, tests passed', reference: 'x'
    }, requesterToken);

    const resultA = await analyze(server, changeA.id, requesterToken);
    const resultB = await analyze(server, changeB.id, requesterToken);

    // A must be assessed as if it has no evidence, despite B having some.
    assert.ok(resultA.body.data.missingEvidence.some((m) => /no evidence/i.test(m)));
    assert.ok(resultB.body.data.riskScore < resultA.body.data.riskScore);
  });

  test('a client cannot supply an evidenceIds field to pull in arbitrary evidence — the field is rejected outright', async () => {
    const change = await createChange('Update marketing copy', 'Fix a typo');
    const { status, body } = await analyze(server, change.id, requesterToken, { evidenceIds: ['anything'] });
    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'evidenceIds'));
  });
});

describe('Evidence-aware AI analysis — lifecycle safety', () => {
  test('analysis does not change ChangeRequest.status', async () => {
    const change = await createChange('Update marketing copy', 'Fix a typo');
    const before_ = await prisma.changeRequest.findUnique({ where: { id: change.id } });
    await analyze(server, change.id, requesterToken);
    const after_ = await prisma.changeRequest.findUnique({ where: { id: change.id } });
    assert.equal(after_.status, before_.status);
    assert.equal(after_.status, 'DRAFT');
  });

  test('analysis does not modify or delete existing Evidence', async () => {
    const change = await createChange('Run production database migration', 'Migrate tables');
    const { body: created } = await addEvidence(server, change.id, {
      type: 'ROLLBACK_PLAN', title: 'Rollback plan', description: 'rollback documented', reference: 'x', metadata: { verified: true }
    }, requesterToken);

    await analyze(server, change.id, requesterToken);

    const stored = await prisma.evidence.findUnique({ where: { id: created.data.id } });
    assert.equal(stored.title, 'Rollback plan');
    assert.equal(stored.reference, 'x');
    assert.deepEqual(stored.metadata, { verified: true });
  });

  test('analysis creates a new AIAnalysis row and does not touch AIAnalysis ownership/RBAC', async () => {
    const change = await createChange('Update marketing copy', 'Fix a typo');
    const countBefore = await prisma.aIAnalysis.count({ where: { changeRequestId: change.id } });
    await analyze(server, change.id, requesterToken);
    const countAfter = await prisma.aIAnalysis.count({ where: { changeRequestId: change.id } });
    assert.equal(countAfter, countBefore + 1);
  });
});
