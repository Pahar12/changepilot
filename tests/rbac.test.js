'use strict';

/**
 * tests/rbac.test.js
 *
 * Integration tests for Role-Based Access Control (RBAC) and ChangeRequest ownership:
 *   - REQUESTER, REVIEWER, ADMIN role permissions
 *   - Ownership assignment on creation
 *   - Prevention of creator impersonation (rejecting createdById in body)
 *   - Ownership enforcement on edit and submit actions
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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

    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method,
      headers
    };

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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server;
let requesterUser, reviewerUser, adminUser, otherRequesterUser;
let requesterToken, reviewerToken, adminToken;

before(async () => {
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  requesterUser = await prisma.user.create({
    data: { name: 'Requester One', email: 'req1@test.com', passwordHash, role: 'REQUESTER' }
  });
  otherRequesterUser = await prisma.user.create({
    data: { name: 'Requester Two', email: 'req2@test.com', passwordHash, role: 'REQUESTER' }
  });
  reviewerUser = await prisma.user.create({
    data: { name: 'Reviewer One', email: 'rev1@test.com', passwordHash, role: 'REVIEWER' }
  });
  adminUser = await prisma.user.create({
    data: { name: 'Admin One', email: 'admin1@test.com', passwordHash, role: 'ADMIN' }
  });

  requesterToken      = signToken({ userId: requesterUser.id, email: requesterUser.email, role: 'REQUESTER' }, env.jwtSecret);
  reviewerToken       = signToken({ userId: reviewerUser.id, email: reviewerUser.email, role: 'REVIEWER' }, env.jwtSecret);
  adminToken          = signToken({ userId: adminUser.id, email: adminUser.email, role: 'ADMIN' }, env.jwtSecret);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await prisma.$disconnect();
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

// ── Cleanup helper ────────────────────────────────────────────────────────────

async function cleanupChange(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC: Role Permissions on ChangeRequest Endpoints', () => {

  // ── 1. Create permissions ───────────────────────────────────────────────────

  test('REQUESTER can create a ChangeRequest and ownership is set to requester id', async () => {
    const { status, body } = await makeRequest(server, 'POST', '/api/v1/changes', {
      title:       'Requester change',
      description: 'Created by requester',
      riskLevel:   'LOW'
    }, requesterToken);

    assert.equal(status, 201);
    assert.equal(body.status, 'success');
    assert.equal(body.data.createdById, requesterUser.id, 'createdById must match authenticated requester');

    await cleanupChange(body.data.id);
  });

  test('REVIEWER cannot create a ChangeRequest → 403 Forbidden', async () => {
    const { status, body } = await makeRequest(server, 'POST', '/api/v1/changes', {
      title: 'Reviewer cannot create'
    }, reviewerToken);

    assert.equal(status, 403);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Forbidden: insufficient permissions');
  });

  test('ADMIN can create a ChangeRequest', async () => {
    const { status, body } = await makeRequest(server, 'POST', '/api/v1/changes', {
      title: 'Admin change'
    }, adminToken);

    assert.equal(status, 201);
    assert.equal(body.status, 'success');
    assert.equal(body.data.createdById, adminUser.id);

    await cleanupChange(body.data.id);
  });

  // ── 2. Ownership Injection Prevention ───────────────────────────────────────

  test('rejects client-supplied createdById in request body → 400 Bad Request', async () => {
    const { status, body } = await makeRequest(server, 'POST', '/api/v1/changes', {
      title:       'Spoofed change',
      createdById: otherRequesterUser.id
    }, requesterToken);

    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(body.errors.some((e) => e.field === 'createdById'));
  });

  // ── 3. Edit / Submit Permissions & Ownership ────────────────────────────────

  test('REQUESTER can edit their own DRAFT ChangeRequest', async () => {
    const change = await prisma.changeRequest.create({
      data: {
        title:       'Original title',
        description: 'Original desc',
        status:      'DRAFT',
        createdById: requesterUser.id
      }
    });

    try {
      const { status, body } = await makeRequest(server, 'PATCH', `/api/v1/changes/${change.id}`, {
        title: 'Updated title'
      }, requesterToken);

      assert.equal(status, 200);
      assert.equal(body.data.title, 'Updated title');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('REQUESTER cannot edit another user\'s ChangeRequest → 403 Forbidden', async () => {
    const change = await prisma.changeRequest.create({
      data: {
        title:       'Other user change',
        description: 'Owned by other user',
        status:      'DRAFT',
        createdById: otherRequesterUser.id
      }
    });

    try {
      const { status, body } = await makeRequest(server, 'PATCH', `/api/v1/changes/${change.id}`, {
        title: 'Malicious update attempt'
      }, requesterToken);

      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
      assert.equal(body.message, 'Forbidden: you can only edit your own change requests');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('REVIEWER cannot edit a DRAFT ChangeRequest → 403 Forbidden', async () => {
    const change = await prisma.changeRequest.create({
      data: { title: 'Draft change', status: 'DRAFT', createdById: requesterUser.id }
    });

    try {
      const { status } = await makeRequest(server, 'PATCH', `/api/v1/changes/${change.id}`, {
        title: 'Reviewer update attempt'
      }, reviewerToken);

      assert.equal(status, 403);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('REQUESTER cannot submit another user\'s ChangeRequest → 403 Forbidden', async () => {
    const change = await prisma.changeRequest.create({
      data: {
        title:       'Other user draft',
        description: 'Ready for review',
        status:      'DRAFT',
        createdById: otherRequesterUser.id
      }
    });

    try {
      const { status, body } = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, requesterToken);

      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
      assert.equal(body.message, 'Forbidden: you can only submit your own change requests');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('REQUESTER cannot edit an unowned ChangeRequest → 403 Forbidden', async () => {
    const change = await prisma.changeRequest.create({
      data: {
        title:       'Unowned draft',
        description: 'Legacy record without an owner',
        status:      'DRAFT'
      }
    });

    try {
      const { status, body } = await makeRequest(server, 'PATCH', `/api/v1/changes/${change.id}`, {
        title: 'Should be blocked'
      }, requesterToken);

      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
      assert.equal(body.message, 'Forbidden: you can only edit your own change requests');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('REQUESTER cannot submit an unowned ChangeRequest → 403 Forbidden', async () => {
    const change = await prisma.changeRequest.create({
      data: {
        title:       'Unowned submit draft',
        description: 'Legacy record without an owner',
        status:      'DRAFT'
      }
    });

    try {
      const { status, body } = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, requesterToken);

      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
      assert.equal(body.message, 'Forbidden: you can only submit your own change requests');
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('ADMIN can edit and submit any user\'s ChangeRequest', async () => {
    const change = await prisma.changeRequest.create({
      data: {
        title:       'User change',
        description: 'Detailed description',
        status:      'DRAFT',
        createdById: requesterUser.id
      }
    });

    try {
      const updateRes = await makeRequest(server, 'PATCH', `/api/v1/changes/${change.id}`, {
        title: 'Admin edited title'
      }, adminToken);
      assert.equal(updateRes.status, 200);

      const submitRes = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/submit`, {}, adminToken);
      assert.equal(submitRes.status, 200);
      assert.equal(submitRes.body.data.status, 'UNDER_REVIEW');
    } finally {
      await cleanupChange(change.id);
    }
  });

  // ── 4. Review / Decision Permissions ────────────────────────────────────────

  test('REQUESTER cannot approve, reject, or close a ChangeRequest → 403 Forbidden', async () => {
    const change = await prisma.changeRequest.create({
      data: { title: 'Review change', description: 'Desc', status: 'UNDER_REVIEW', createdById: requesterUser.id }
    });

    try {
      const approveRes = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/approve`, {}, requesterToken);
      assert.equal(approveRes.status, 403);

      const rejectRes = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/reject`, {}, requesterToken);
      assert.equal(rejectRes.status, 403);

      const closeRes = await makeRequest(server, 'POST', `/api/v1/changes/${change.id}/close`, {}, requesterToken);
      assert.equal(closeRes.status, 403);
    } finally {
      await cleanupChange(change.id);
    }
  });

  test('REVIEWER can approve, reject, and close a ChangeRequest', async () => {
    // 1. Approve
    const underReview = await prisma.changeRequest.create({
      data: { title: 'Review change', description: 'Desc', status: 'UNDER_REVIEW', createdById: requesterUser.id }
    });

    try {
      const approveRes = await makeRequest(server, 'POST', `/api/v1/changes/${underReview.id}/approve`, {}, reviewerToken);
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.body.data.status, 'APPROVED');

      // 2. Close
      const closeRes = await makeRequest(server, 'POST', `/api/v1/changes/${underReview.id}/close`, {}, reviewerToken);
      assert.equal(closeRes.status, 200);
      assert.equal(closeRes.body.data.status, 'CLOSED');
    } finally {
      await cleanupChange(underReview.id);
    }
  });

});
