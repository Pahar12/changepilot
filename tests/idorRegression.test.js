'use strict';

/**
 * tests/idorRegression.test.js
 *
 * Regression tests for a Phase 5 finding: GET /api/v1/changes/:id and
 * GET /api/v1/changes previously had NO ownership check at all, meaning any
 * authenticated REQUESTER could read any other user's ChangeRequest by UUID,
 * or see every user's records in the list endpoint. Fixed in
 * changeService.js (getChangeById, listChanges) to match the ownership rule
 * already enforced everywhere else (update/submit/evidence/analyze).
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

function get(server, path, token) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

let server;
let userA, userB, reviewerUser, adminUser;
let tokenA, tokenB, reviewerToken, adminToken;
let changeOwnedByA;

before(async () => {
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  userA = await prisma.user.create({ data: { name: 'IDOR User A', email: 'idor-a@test.com', passwordHash, role: 'REQUESTER' } });
  userB = await prisma.user.create({ data: { name: 'IDOR User B', email: 'idor-b@test.com', passwordHash, role: 'REQUESTER' } });
  reviewerUser = await prisma.user.create({ data: { name: 'IDOR Reviewer', email: 'idor-rev@test.com', passwordHash, role: 'REVIEWER' } });
  adminUser = await prisma.user.create({ data: { name: 'IDOR Admin', email: 'idor-admin@test.com', passwordHash, role: 'ADMIN' } });

  tokenA = signToken({ userId: userA.id, email: userA.email, role: 'REQUESTER' }, env.jwtSecret);
  tokenB = signToken({ userId: userB.id, email: userB.email, role: 'REQUESTER' }, env.jwtSecret);
  reviewerToken = signToken({ userId: reviewerUser.id, email: reviewerUser.email, role: 'REVIEWER' }, env.jwtSecret);
  adminToken = signToken({ userId: adminUser.id, email: adminUser.email, role: 'ADMIN' }, env.jwtSecret);

  changeOwnedByA = await prisma.changeRequest.create({
    data: { title: 'User A private change', description: 'Should not be visible to User B', createdById: userA.id }
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await prisma.changeRequest.deleteMany({ where: { id: changeOwnedByA.id } }).catch(() => {});
  await prisma.$disconnect();
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

describe('IDOR regression — GET /api/v1/changes/:id', () => {
  test('the owning REQUESTER can fetch their own change', async () => {
    const { status } = await get(server, `/api/v1/changes/${changeOwnedByA.id}`, tokenA);
    assert.equal(status, 200);
  });

  test('a different REQUESTER cannot fetch another user\'s change (403, not 200)', async () => {
    const { status, body } = await get(server, `/api/v1/changes/${changeOwnedByA.id}`, tokenB);
    assert.equal(status, 403);
    assert.equal(body.status, 'fail');
  });

  test('REVIEWER can fetch any change', async () => {
    const { status } = await get(server, `/api/v1/changes/${changeOwnedByA.id}`, reviewerToken);
    assert.equal(status, 200);
  });

  test('ADMIN can fetch any change', async () => {
    const { status } = await get(server, `/api/v1/changes/${changeOwnedByA.id}`, adminToken);
    assert.equal(status, 200);
  });
});

describe('IDOR regression — GET /api/v1/changes (list)', () => {
  test('a REQUESTER never sees another user\'s change in the list', async () => {
    const { status, body } = await get(server, '/api/v1/changes?limit=100', tokenB);
    assert.equal(status, 200);
    assert.ok(!body.data.some((c) => c.id === changeOwnedByA.id), 'User B\'s list must not contain User A\'s change');
  });

  test('the owning REQUESTER does see their own change in the list', async () => {
    const { status, body } = await get(server, '/api/v1/changes?limit=100', tokenA);
    assert.equal(status, 200);
    assert.ok(body.data.some((c) => c.id === changeOwnedByA.id));
  });

  test('REVIEWER sees the change in the unrestricted list', async () => {
    const { body } = await get(server, '/api/v1/changes?limit=100', reviewerToken);
    assert.ok(body.data.some((c) => c.id === changeOwnedByA.id));
  });

  test('ADMIN sees the change in the unrestricted list', async () => {
    const { body } = await get(server, '/api/v1/changes?limit=100', adminToken);
    assert.ok(body.data.some((c) => c.id === changeOwnedByA.id));
  });
});
