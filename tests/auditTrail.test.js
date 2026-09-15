'use strict';

/**
 * tests/auditTrail.test.js
 *
 * Integration tests for the Phase 3 centralized audit trail:
 *   - CHANGE_CREATED / CHANGE_UPDATED / CHANGE_SUBMITTED / CHANGE_APPROVED /
 *     CHANGE_REJECTED / CHANGE_CLOSED (src/services/changeService.js)
 *   - EVIDENCE_CREATED (src/services/evidenceService.js)
 *   - AI_ANALYSIS_COMPLETED / AI_ANALYSIS_FAILED (src/services/aiAnalysisService.js)
 *
 * Focus: actor integrity, metadata safety, and that a failed/blocked
 * business operation never leaves behind a misleading audit row (the
 * transaction-boundary guarantee described in changeService.js).
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
const { INVALID_OUTPUT_TRIGGER, FAILURE_TRIGGER } = require('../src/ai/providers/fakeProvider');

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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server;
let requesterUser, reviewerUser, adminUser;
let requesterToken, reviewerToken, adminToken;

before(async () => {
  await prisma.auditEvent.deleteMany({});
  await prisma.aIAnalysis.deleteMany({});
  await prisma.evidence.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  requesterUser = await prisma.user.create({
    data: { name: 'Audit Requester', email: 'audit-req@test.com', passwordHash, role: 'REQUESTER' }
  });
  reviewerUser = await prisma.user.create({
    data: { name: 'Audit Reviewer', email: 'audit-rev@test.com', passwordHash, role: 'REVIEWER' }
  });
  adminUser = await prisma.user.create({
    data: { name: 'Audit Admin', email: 'audit-admin@test.com', passwordHash, role: 'ADMIN' }
  });

  requesterToken = signToken({ userId: requesterUser.id, email: requesterUser.email, role: 'REQUESTER' }, env.jwtSecret);
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

function auditEventsFor(changeRequestId, action) {
  const where = { changeRequestId };
  if (action) where.action = action;
  return prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'asc' } });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Audit trail — ChangeRequest lifecycle', () => {
  test('creating a change writes exactly one CHANGE_CREATED event with the real actor', async () => {
    const { body } = await request(server, 'POST', '/api/v1/changes', {
      title: 'Rotate database credentials',
      description: 'Quarterly credential rotation'
    }, requesterToken);
    const change = body.data;

    const events = await auditEventsFor(change.id, 'CHANGE_CREATED');
    assert.equal(events.length, 1);
    assert.equal(events[0].actorId, requesterUser.id);
    assert.equal(events[0].entityType, 'ChangeRequest');
    assert.equal(events[0].entityId, change.id);
    assert.equal(events[0].metadata.title, 'Rotate database credentials');
    assert.equal(events[0].metadata.riskLevel, 'LOW');
  });

  test('a client cannot forge the audit actor via the request body (rejected at validation, 400)', async () => {
    const { status, body } = await request(server, 'POST', '/api/v1/changes', {
      title: 'Attempted actor forgery',
      actorId: reviewerUser.id,
      createdById: reviewerUser.id
    }, requesterToken);
    assert.equal(status, 400);
    const fields = body.errors.map((e) => e.field);
    assert.ok(fields.includes('actorId'));
    assert.ok(fields.includes('createdById'));
  });

  test('the full lifecycle (create → update → submit → approve → close) writes one event per transition, each with the correct actor', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: 'Initial title',
      description: 'Initial description is long enough to submit'
    }, requesterToken);
    const change = createBody.data;

    await request(server, 'PATCH', `/api/v1/changes/${change.id}`, { title: 'Updated title' }, requesterToken);
    await request(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, requesterToken);
    await request(server, 'POST', `/api/v1/changes/${change.id}/approve`, {}, reviewerToken);
    await request(server, 'POST', `/api/v1/changes/${change.id}/close`, {}, adminToken);

    const allEvents = await auditEventsFor(change.id);
    const byAction = Object.fromEntries(allEvents.map((e) => [e.action, e]));

    assert.equal(allEvents.length, 5, `expected 5 events, got: ${allEvents.map((e) => e.action).join(', ')}`);
    assert.equal(byAction.CHANGE_CREATED.actorId, requesterUser.id);
    assert.equal(byAction.CHANGE_UPDATED.actorId, requesterUser.id);
    assert.deepEqual(byAction.CHANGE_UPDATED.metadata.changedFields, ['title']);
    assert.equal(byAction.CHANGE_SUBMITTED.actorId, requesterUser.id);
    assert.deepEqual(
      { from: byAction.CHANGE_SUBMITTED.metadata.fromStatus, to: byAction.CHANGE_SUBMITTED.metadata.toStatus },
      { from: 'DRAFT', to: 'UNDER_REVIEW' }
    );
    assert.equal(byAction.CHANGE_APPROVED.actorId, reviewerUser.id);
    assert.equal(byAction.CHANGE_CLOSED.actorId, adminUser.id);
    assert.equal(byAction.CHANGE_CLOSED.metadata.fromStatus, 'APPROVED');

    // Chronological ordering matches the actual sequence of operations.
    const order = allEvents.map((e) => e.action);
    assert.deepEqual(order, ['CHANGE_CREATED', 'CHANGE_UPDATED', 'CHANGE_SUBMITTED', 'CHANGE_APPROVED', 'CHANGE_CLOSED']);
  });

  test('rejecting a change writes CHANGE_REJECTED with the reviewer as actor', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: 'To be rejected',
      description: 'This change will be rejected'
    }, requesterToken);
    const change = createBody.data;

    await request(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, requesterToken);
    await request(server, 'POST', `/api/v1/changes/${change.id}/reject`, {}, reviewerToken);

    const [event] = await auditEventsFor(change.id, 'CHANGE_REJECTED');
    assert.ok(event);
    assert.equal(event.actorId, reviewerUser.id);
    assert.equal(event.metadata.toStatus, 'REJECTED');
  });

  test('a failed transition (wrong status) never creates a misleading audit event', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: 'Double submit attempt',
      description: 'Testing the transaction boundary'
    }, requesterToken);
    const change = createBody.data;

    const first = await request(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, requesterToken);
    assert.equal(first.status, 200);

    // Second submit attempt must fail (already UNDER_REVIEW) and must NOT
    // produce a second CHANGE_SUBMITTED event.
    const second = await request(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, requesterToken);
    assert.equal(second.status, 409);

    const events = await auditEventsFor(change.id, 'CHANGE_SUBMITTED');
    assert.equal(events.length, 1, 'exactly one CHANGE_SUBMITTED event must exist despite two submit attempts');

    // Approving from the wrong role/state should likewise never write an event.
    const badApprove = await request(server, 'POST', `/api/v1/changes/${change.id}/approve`, {}, reviewerToken);
    assert.equal(badApprove.status, 200); // this one IS valid (UNDER_REVIEW -> APPROVED)
    const badClose = await request(server, 'POST', `/api/v1/changes/${change.id}/close`, {}, adminToken);
    assert.equal(badClose.status, 200);
    const secondClose = await request(server, 'POST', `/api/v1/changes/${change.id}/close`, {}, adminToken);
    assert.equal(secondClose.status, 409);

    const closeEvents = await auditEventsFor(change.id, 'CHANGE_CLOSED');
    assert.equal(closeEvents.length, 1, 'exactly one CHANGE_CLOSED event must exist despite two close attempts');
  });
});

describe('Audit trail — Evidence', () => {
  test('creating evidence writes exactly one EVIDENCE_CREATED event', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: 'Change with evidence',
      description: 'For evidence audit testing'
    }, requesterToken);
    const change = createBody.data;

    const { body: evidenceBody } = await request(server, 'POST', `/api/v1/changes/${change.id}/evidence`, {
      type: 'TEST_REPORT',
      title: 'CI run',
      reference: 'https://ci.example.com/1'
    }, requesterToken);

    const events = await auditEventsFor(change.id, 'EVIDENCE_CREATED');
    assert.equal(events.length, 1);
    assert.equal(events[0].actorId, requesterUser.id);
    assert.equal(events[0].entityType, 'Evidence');
    assert.equal(events[0].entityId, evidenceBody.data.id);
    assert.equal(events[0].metadata.type, 'TEST_REPORT');
  });
});

describe('Audit trail — AI analysis', () => {
  test('a successful analysis writes exactly one AI_ANALYSIS_COMPLETED event', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: 'Update marketing copy',
      description: 'Fix a typo'
    }, requesterToken);
    const change = createBody.data;

    const { body: analyzeBody } = await request(server, 'POST', `/api/v1/changes/${change.id}/analyze`, {}, requesterToken);

    const events = await auditEventsFor(change.id, 'AI_ANALYSIS_COMPLETED');
    assert.equal(events.length, 1);
    assert.equal(events[0].entityType, 'AIAnalysis');
    assert.equal(events[0].entityId, analyzeBody.data.id);
    assert.equal(events[0].actorId, requesterUser.id);
  });

  test('a provider failure writes AI_ANALYSIS_FAILED, not AI_ANALYSIS_COMPLETED', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: FAILURE_TRIGGER,
      description: 'Triggers the fake provider failure path'
    }, requesterToken);
    const change = createBody.data;

    const { status } = await request(server, 'POST', `/api/v1/changes/${change.id}/analyze`, {}, requesterToken);
    assert.equal(status, 502);

    const failedEvents = await auditEventsFor(change.id, 'AI_ANALYSIS_FAILED');
    const completedEvents = await auditEventsFor(change.id, 'AI_ANALYSIS_COMPLETED');
    assert.equal(failedEvents.length, 1);
    assert.equal(completedEvents.length, 0);
    assert.equal(failedEvents[0].metadata.reason, 'provider_request_failed');
    assert.equal(failedEvents[0].actorId, requesterUser.id);
  });

  test('invalid provider output writes AI_ANALYSIS_FAILED with the invalid field names', async () => {
    const { body: createBody } = await request(server, 'POST', '/api/v1/changes', {
      title: INVALID_OUTPUT_TRIGGER,
      description: 'Triggers the fake provider invalid-output path'
    }, requesterToken);
    const change = createBody.data;

    const { status } = await request(server, 'POST', `/api/v1/changes/${change.id}/analyze`, {}, requesterToken);
    assert.equal(status, 502);

    const [event] = await auditEventsFor(change.id, 'AI_ANALYSIS_FAILED');
    assert.ok(event);
    assert.equal(event.metadata.reason, 'invalid_ai_output');
    assert.ok(Array.isArray(event.metadata.invalidFields));
    assert.ok(event.metadata.invalidFields.length > 0);
  });
});

describe('Audit trail — metadata safety', () => {
  test('no audit event recorded during this test file contains a secret-shaped key or a raw token value', async () => {
    const events = await prisma.auditEvent.findMany({
      where: { actorId: { in: [requesterUser.id, reviewerUser.id, adminUser.id] } }
    });

    assert.ok(events.length > 0, 'sanity check: there should be audit events to scan');

    const forbiddenKeyPattern = /password|secret|token|jwt|api[-_]?key|authorization|credential/i;
    const tokens = [requesterToken, reviewerToken, adminToken];

    for (const event of events) {
      if (!event.metadata) continue;
      const serialised = JSON.stringify(event.metadata);

      // No forbidden-looking key made it into a persisted row.
      for (const key of Object.keys(event.metadata)) {
        assert.ok(!forbiddenKeyPattern.test(key), `event ${event.id} (${event.action}) has a secret-shaped metadata key: ${key}`);
      }

      // No raw JWT ever ended up embedded in metadata as a value.
      for (const token of tokens) {
        assert.ok(!serialised.includes(token), `event ${event.id} (${event.action}) metadata contains a raw JWT`);
      }
    }
  });
});
