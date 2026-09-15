'use strict';

/**
 * tests/evidence.test.js
 *
 * Integration tests for the Evidence resource:
 *   POST /api/v1/changes/:id/evidence
 *   GET  /api/v1/changes/:id/evidence
 *   GET  /api/v1/evidence/:id
 *
 * Strategy: same as tests/rbac.test.js and tests/changes.analyze.test.js —
 * import the Express app directly, bind it to a random port, make real HTTP
 * requests with node:http.
 *
 * NOTE: like every DB-touching file in this directory, these tests require
 * a reachable PostgreSQL database and a matching-platform Prisma Query
 * Engine. See the project report for the sandbox's Linux/Mac engine
 * mismatch — these tests could not be executed end-to-end in that sandbox.
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

// ── HTTP helpers ─────────────────────────────────────────────────────────────

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

function createEvidence(server, changeId, payload, token) {
  return request(server, 'POST', `/api/v1/changes/${changeId}/evidence`, payload, token);
}

function listEvidence(server, changeId, token) {
  return request(server, 'GET', `/api/v1/changes/${changeId}/evidence`, undefined, token);
}

function getEvidenceById(server, evidenceId, token) {
  return request(server, 'GET', `/api/v1/evidence/${evidenceId}`, undefined, token);
}

const validEvidence = {
  type: 'TEST_REPORT',
  title: 'CI test run',
  description: 'All tests passed on staging',
  reference: 'https://ci.example.com/runs/123',
  metadata: { suite: 'integration', passed: 42 }
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server;
let requesterUser, otherRequesterUser, reviewerUser, adminUser;
let requesterToken, otherRequesterToken, reviewerToken, adminToken;

before(async () => {
  await prisma.evidence.deleteMany({});
  await prisma.aIAnalysis.deleteMany({});
  await prisma.auditEvent.deleteMany({});
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  requesterUser = await prisma.user.create({
    data: { name: 'Evidence Requester', email: 'evidence-req@test.com', passwordHash, role: 'REQUESTER' }
  });
  otherRequesterUser = await prisma.user.create({
    data: { name: 'Evidence Other Requester', email: 'evidence-req2@test.com', passwordHash, role: 'REQUESTER' }
  });
  reviewerUser = await prisma.user.create({
    data: { name: 'Evidence Reviewer', email: 'evidence-rev@test.com', passwordHash, role: 'REVIEWER' }
  });
  adminUser = await prisma.user.create({
    data: { name: 'Evidence Admin', email: 'evidence-admin@test.com', passwordHash, role: 'ADMIN' }
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

async function createChange(token) {
  const { body } = await request(server, 'POST', '/api/v1/changes', {
    title: 'Update payment webhook handler',
    description: 'Adds retry logic for failed webhook deliveries'
  }, token);
  return body.data;
}

async function cleanupChange(id) {
  if (!id) return;
  await prisma.evidence.deleteMany({ where: { changeRequestId: id } }).catch(() => {});
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/changes/:id/evidence', () => {
  test('no Authorization header returns 401', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await createEvidence(server, change.id, validEvidence, undefined);
      assert.equal(status, 401);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('malformed (non-UUID) change id returns 400', async () => {
    const { status } = await createEvidence(server, 'not-a-uuid', validEvidence, requesterToken);
    assert.equal(status, 400);
  });

  test('SQL-injection-shaped change id is rejected as an invalid UUID (400), never reaches the database', async () => {
    const { status } = await createEvidence(server, "1' OR '1'='1", validEvidence, requesterToken);
    assert.equal(status, 400);
  });

  test('nonexistent change request returns 404', async () => {
    const { status, body } = await createEvidence(server, NONEXISTENT_UUID, validEvidence, requesterToken);
    assert.equal(status, 404);
    assert.equal(body.status, 'fail');
  });

  test('a REQUESTER creating evidence on their own change request succeeds with 201', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, validEvidence, requesterToken);
      assert.equal(status, 201);
      assert.equal(body.status, 'success');
      assert.equal(body.data.changeRequestId, change.id);
      assert.equal(body.data.type, 'TEST_REPORT');
      assert.equal(body.data.title, 'CI test run');
      assert.equal(body.data.reference, 'https://ci.example.com/runs/123');
      // submittedById must be derived from the authenticated user, never client input.
      assert.equal(body.data.submittedById, requesterUser.id);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REQUESTER cannot add evidence to another REQUESTER\'s change request (403)', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, validEvidence, otherRequesterToken);
      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REVIEWER cannot create evidence (403 — same role split as creating a ChangeRequest)', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await createEvidence(server, change.id, validEvidence, reviewerToken);
      assert.equal(status, 403);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('an ADMIN can add evidence to any change request', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, validEvidence, adminToken);
      assert.equal(status, 201);
      assert.equal(body.data.submittedById, adminUser.id);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('missing required fields (type, title, reference) are all reported', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, {}, requesterToken);
      assert.equal(status, 400);
      const fields = body.errors.map((e) => e.field);
      assert.ok(fields.includes('type'));
      assert.ok(fields.includes('title'));
      assert.ok(fields.includes('reference'));
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('an unknown field is rejected', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, { ...validEvidence, foo: 'bar' }, requesterToken);
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'foo'));
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('ownership-manipulation fields (createdById, submittedById, userId, ownerId) are all rejected', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, {
        ...validEvidence,
        createdById: otherRequesterUser.id,
        submittedById: otherRequesterUser.id,
        userId: otherRequesterUser.id,
        ownerId: otherRequesterUser.id
      }, requesterToken);
      assert.equal(status, 400);
      const fields = body.errors.map((e) => e.field);
      for (const forbidden of ['createdById', 'submittedById', 'userId', 'ownerId']) {
        assert.ok(fields.includes(forbidden), `expected "${forbidden}" to be rejected`);
      }
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('non-string type is rejected', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, { ...validEvidence, type: 123 }, requesterToken);
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'type'));
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('metadata must be a JSON object, not an array or primitive', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, { ...validEvidence, metadata: ['not', 'an', 'object'] }, requesterToken);
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'metadata'));
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('evidence can be created without optional description/metadata', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await createEvidence(server, change.id, {
        type: 'DEPLOYMENT_LOG',
        title: 'Staging deploy log',
        reference: 'https://ci.example.com/deploys/9'
      }, requesterToken);
      assert.equal(status, 201);
      assert.equal(body.data.description, null);
    } finally {
      await cleanupChange(change.id);
    }
  });
});

describe('GET /api/v1/changes/:id/evidence', () => {
  test('no Authorization header returns 401', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await listEvidence(server, change.id, undefined);
      assert.equal(status, 401);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('malformed change id returns 400', async () => {
    const { status } = await listEvidence(server, 'not-a-uuid', requesterToken);
    assert.equal(status, 400);
  });

  test('nonexistent change request returns 404', async () => {
    const { status } = await listEvidence(server, NONEXISTENT_UUID, requesterToken);
    assert.equal(status, 404);
  });

  test('a REQUESTER can list evidence on their own change request', async () => {
    const change = await createChange(requesterToken);
    try {
      await createEvidence(server, change.id, validEvidence, requesterToken);
      const { status, body } = await listEvidence(server, change.id, requesterToken);
      assert.equal(status, 200);
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].changeRequestId, change.id);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REQUESTER cannot list evidence on another REQUESTER\'s change request (403)', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await listEvidence(server, change.id, otherRequesterToken);
      assert.equal(status, 403);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REVIEWER can list evidence on any change request', async () => {
    const change = await createChange(requesterToken);
    try {
      await createEvidence(server, change.id, validEvidence, requesterToken);
      const { status, body } = await listEvidence(server, change.id, reviewerToken);
      assert.equal(status, 200);
      assert.equal(body.data.length, 1);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('an ADMIN can list evidence on any change request', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status } = await listEvidence(server, change.id, adminToken);
      assert.equal(status, 200);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a change request with no evidence returns an empty array, not an error', async () => {
    const change = await createChange(requesterToken);
    try {
      const { status, body } = await listEvidence(server, change.id, requesterToken);
      assert.equal(status, 200);
      assert.deepEqual(body.data, []);
    } finally {
      await cleanupChange(change.id);
    }
  });
});

describe('GET /api/v1/evidence/:id', () => {
  test('no Authorization header returns 401', async () => {
    const { status } = await getEvidenceById(server, NONEXISTENT_UUID, undefined);
    assert.equal(status, 401);
  });

  test('malformed evidence id returns 400', async () => {
    const { status } = await getEvidenceById(server, 'not-a-uuid', requesterToken);
    assert.equal(status, 400);
  });

  test('nonexistent evidence id returns 404', async () => {
    const { status } = await getEvidenceById(server, NONEXISTENT_UUID, requesterToken);
    assert.equal(status, 404);
  });

  test('a REQUESTER can fetch evidence belonging to their own change request', async () => {
    const change = await createChange(requesterToken);
    try {
      const { body: created } = await createEvidence(server, change.id, validEvidence, requesterToken);
      const { status, body } = await getEvidenceById(server, created.data.id, requesterToken);
      assert.equal(status, 200);
      assert.equal(body.data.id, created.data.id);
      // The response must not leak the joined ChangeRequest object.
      assert.equal(body.data.changeRequest, undefined);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REQUESTER cannot fetch evidence belonging to another REQUESTER\'s change request (403)', async () => {
    const change = await createChange(requesterToken);
    try {
      const { body: created } = await createEvidence(server, change.id, validEvidence, requesterToken);
      const { status } = await getEvidenceById(server, created.data.id, otherRequesterToken);
      assert.equal(status, 403);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('a REVIEWER can fetch any evidence record', async () => {
    const change = await createChange(requesterToken);
    try {
      const { body: created } = await createEvidence(server, change.id, validEvidence, requesterToken);
      const { status } = await getEvidenceById(server, created.data.id, reviewerToken);
      assert.equal(status, 200);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('an ADMIN can fetch any evidence record', async () => {
    const change = await createChange(requesterToken);
    try {
      const { body: created } = await createEvidence(server, change.id, validEvidence, requesterToken);
      const { status } = await getEvidenceById(server, created.data.id, adminToken);
      assert.equal(status, 200);
    } finally {
      await cleanupChange(change.id);
    }
  });
});
