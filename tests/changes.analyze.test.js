'use strict';

/**
 * tests/changes.analyze.test.js
 *
 * Integration tests for POST /api/v1/changes/:id/analyze.
 *
 * Strategy: same as tests/rbac.test.js — import the Express app directly,
 * bind it to a random port, and make real HTTP requests with node:http.
 * Uses the AI_PROVIDER default ("fake" — see src/config/env.js and
 * src/ai/index.js), so this suite never calls a real AI vendor and never
 * requires an API key.
 *
 * NOTE: like every other file in this directory, these tests require a
 * reachable PostgreSQL database and a Prisma Query Engine matching the
 * current platform. In the sandbox this code was written in, only a
 * darwin-arm64 engine binary was available and the sandbox could not
 * download a Linux one (network access to Prisma's CDN is blocked there),
 * so this suite could not be executed end-to-end in that environment — see
 * the final report for the exact baseline. It should run normally on a
 * machine with `npx prisma generate` run for its own platform.
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
const { INVALID_OUTPUT_TRIGGER, FAILURE_TRIGGER } = require('../src/ai/providers/fakeProvider');

// ── HTTP helper ─────────────────────────────────────────────────────────────

function makeRequest(server, method, path, payload, token) {
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

    const options = { hostname: '127.0.0.1', port: addr.port, path, method, headers };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: raw });
        }
      });
    });

    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

function analyze(server, id, token) {
  return makeRequest(server, 'POST', `/api/v1/changes/${id}/analyze`, {}, token);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server;
let requesterUser, otherRequesterUser, reviewerUser, adminUser;
let requesterToken, otherRequesterToken, reviewerToken, adminToken;

before(async () => {
  await prisma.aIAnalysis.deleteMany({});
  await prisma.auditEvent.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  requesterUser = await prisma.user.create({
    data: { name: 'Analyze Requester', email: 'analyze-req@test.com', passwordHash, role: 'REQUESTER' }
  });
  otherRequesterUser = await prisma.user.create({
    data: { name: 'Analyze Other Requester', email: 'analyze-req2@test.com', passwordHash, role: 'REQUESTER' }
  });
  reviewerUser = await prisma.user.create({
    data: { name: 'Analyze Reviewer', email: 'analyze-rev@test.com', passwordHash, role: 'REVIEWER' }
  });
  adminUser = await prisma.user.create({
    data: { name: 'Analyze Admin', email: 'analyze-admin@test.com', passwordHash, role: 'ADMIN' }
  });

  requesterToken = signToken({ userId: requesterUser.id, email: requesterUser.email, role: 'REQUESTER' }, env.jwtSecret);
  otherRequesterToken = signToken({ userId: otherRequesterUser.id, email: otherRequesterUser.email, role: 'REQUESTER' }, env.jwtSecret);
  reviewerToken = signToken({ userId: reviewerUser.id, email: reviewerUser.email, role: 'REVIEWER' }, env.jwtSecret);
  adminToken = signToken({ userId: adminUser.id, email: adminUser.email, role: 'ADMIN' }, env.jwtSecret);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await prisma.$disconnect();
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

async function createChange(token, overrides = {}) {
  const { body } = await makeRequest(server, 'POST', '/api/v1/changes', {
    title: 'Update marketing copy',
    description: 'Fix a typo on the homepage',
    ...overrides
  }, token);
  return body.data;
}

async function cleanupChange(id) {
  if (!id) return;
  await prisma.aIAnalysis.deleteMany({ where: { changeRequestId: id } }).catch(() => {});
  await prisma.auditEvent.deleteMany({ where: { changeRequestId: id } }).catch(() => {});
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/changes/:id/analyze', () => {
  test('no Authorization header returns 401', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await analyze(server, change.id, undefined);
      assert.equal(status, 401);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('change request not found returns 404', async () => {
    const { status, body } = await analyze(server, '00000000-0000-4000-8000-000000000000', requesterToken);
    assert.equal(status, 404);
    assert.equal(body.status, 'fail');
  });

  test('malformed id returns 400', async () => {
    const { status } = await analyze(server, 'not-a-uuid', requesterToken);
    assert.equal(status, 400);
  });

  test('a REQUESTER analyzing their own change request succeeds with 201', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await analyze(server, change.id, requesterToken);
      assert.equal(status, 201);
      assert.equal(body.status, 'success');

      const analysis = body.data;
      assert.ok(analysis.id);
      assert.equal(analysis.changeRequestId, change.id);
      assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(analysis.riskLevel));
      assert.ok(Number.isInteger(analysis.riskScore));
      assert.ok(analysis.riskScore >= 0 && analysis.riskScore <= 100);
      assert.ok(analysis.confidence >= 0 && analysis.confidence <= 1);
      assert.ok(['APPROVE', 'CONDITIONAL_APPROVAL', 'REQUEST_MORE_EVIDENCE', 'REJECT'].includes(analysis.recommendation));
      assert.equal(analysis.providerModel, 'fake:deterministic-v1');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REQUESTER analyzing another REQUESTER\'s change request gets 403', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await analyze(server, change.id, otherRequesterToken);
      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REVIEWER can analyze any change request', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await analyze(server, change.id, reviewerToken);
      assert.equal(status, 201);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('an ADMIN can analyze any change request', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await analyze(server, change.id, adminToken);
      assert.equal(status, 201);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('supplying a body field is rejected as unknown field', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/analyze`, { riskLevel: 'HIGH' }, requesterToken);
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a persisted analysis is retrievable directly from the database', async () => {
    const change = await createChange(requesterToken);
    try {
      const { body } = await analyze(server, change.id, requesterToken);
      const stored = await prisma.aIAnalysis.findUnique({ where: { id: body.data.id } });
      assert.ok(stored);
      assert.equal(stored.changeRequestId, change.id);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a successful analysis creates an AI_ANALYSIS_COMPLETED audit event', async () => {
    const change = await createChange(requesterToken);
    try {
      const { body } = await analyze(server, change.id, requesterToken);
      const events = await prisma.auditEvent.findMany({ where: { changeRequestId: change.id, action: 'AI_ANALYSIS_COMPLETED' } });
      assert.equal(events.length, 1);
      assert.equal(events[0].entityId, body.data.id);
      assert.equal(events[0].entityType, 'AIAnalysis');
      assert.equal(events[0].actorId, requesterUser.id);
      assert.equal(JSON.stringify(events[0].metadata).includes('apiKey'), false);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('invalid AI provider output fails safely with 502 and nothing is persisted', async () => {
    const change = await createChange(requesterToken, { title: INVALID_OUTPUT_TRIGGER });
    try {
      const { status, body } = await analyze(server, change.id, requesterToken);
      assert.equal(status, 502);
      assert.equal(body.status, 'fail');
      assert.ok(Array.isArray(body.errors));

      const stored = await prisma.aIAnalysis.findMany({ where: { changeRequestId: change.id } });
      assert.equal(stored.length, 0);
      const events = await prisma.auditEvent.findMany({ where: { changeRequestId: change.id } });
      assert.equal(events.length, 0);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('AI provider failure fails safely with 502 and nothing is persisted', async () => {
    const change = await createChange(requesterToken, { title: FAILURE_TRIGGER });
    try {
      const { status, body } = await analyze(server, change.id, requesterToken);
      assert.equal(status, 502);
      assert.equal(body.status, 'fail');

      const stored = await prisma.aIAnalysis.findMany({ where: { changeRequestId: change.id } });
      assert.equal(stored.length, 0);
    } finally {
      await cleanupChange(change.id);
    }
  });
});
