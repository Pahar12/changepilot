'use strict';

/**
 * tests/changes.reject.test.js
 *
 * Integration tests for POST /api/v1/changes/:id/reject.
 *
 * Strategy: same as approve — before() truncates, try/finally cleanup per test.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

require('dotenv').config();

const app    = require('../app');
const prisma = require('../src/lib/prisma');
const { signToken } = require('../src/lib/jwt');
const { hashPassword } = require('../src/lib/crypto');
const env = require('../src/config/env');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function post(server, path, payload) {
  return new Promise((resolve, reject) => {
    const data = payload !== undefined ? JSON.stringify(payload) : '';
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization:    `Bearer ${reviewerToken}`
      }
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
    req.write(data);
    req.end();
  });
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;
let requesterUser;
let reviewerUser;
let reviewerToken;

before(async () => {
  await prisma.user.deleteMany({});
  await prisma.changeRequest.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  requesterUser = await prisma.user.create({
    data: {
      name: 'Requester One',
      email: 'changes-reject-requester@example.com',
      passwordHash,
      role: 'REQUESTER'
    }
  });

  reviewerUser = await prisma.user.create({
    data: {
      name: 'Reviewer One',
      email: 'changes-reject-reviewer@example.com',
      passwordHash,
      role: 'REVIEWER'
    }
  });

  reviewerToken = signToken(
    { userId: reviewerUser.id, email: reviewerUser.email, role: reviewerUser.role },
    env.jwtSecret,
    env.jwtExpiresIn
  );

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

// ── Seed / cleanup helpers ────────────────────────────────────────────────────

async function seed(fields) {
  return prisma.changeRequest.create({
    data: {
      ...fields,
      createdById: fields.createdById ?? requesterUser.id
    }
  });
}

async function cleanup(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

function reject(id, body) {
  return post(server, `/api/v1/changes/${id}/reject`, body !== undefined ? body : {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/changes/:id/reject', () => {

  // ── Happy path ────────────────────────────────────────────────────────────

  test('UNDER_REVIEW → 200', async () => {
    const record = await seed({
      title:       'Reject me',
      description: 'Ready to be rejected',
      status:      'UNDER_REVIEW',
      riskLevel:   'HIGH'
    });
    try {
      const { status } = await reject(record.id);
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned status is REJECTED', async () => {
    const record = await seed({
      title:       'Status check',
      description: 'Valid description',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await reject(record.id);
      assert.equal(body.data.status, 'REJECTED');
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned ID remains unchanged', async () => {
    const record = await seed({
      title:       'ID stability',
      description: 'Some description',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await reject(record.id);
      assert.equal(body.data.id, record.id);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned title and description remain unchanged', async () => {
    const record = await seed({
      title:       'Unchanged fields',
      description: 'Original description',
      status:      'UNDER_REVIEW',
      riskLevel:   'CRITICAL'
    });
    try {
      const { body } = await reject(record.id);
      assert.equal(body.data.title,       'Unchanged fields');
      assert.equal(body.data.description, 'Original description');
    } finally {
      await cleanup(record.id);
    }
  });

  test('updatedAt changes after reject', async () => {
    const record = await seed({
      title:       'Timestamp test',
      description: 'Check timestamp',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      await new Promise((r) => setTimeout(r, 5));
      const { body } = await reject(record.id);
      assert.notEqual(
        new Date(body.data.updatedAt).getTime(),
        new Date(record.updatedAt).getTime()
      );
    } finally {
      await cleanup(record.id);
    }
  });

  test('response Content-Type is application/json', async () => {
    const record = await seed({
      title:       'Content-type',
      description: 'Check header',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { headers } = await reject(record.id);
      assert.ok(
        (headers['content-type'] || '').includes('application/json'),
        `Expected application/json, got: ${headers['content-type']}`
      );
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Wrong status (409) ────────────────────────────────────────────────────

  test('DRAFT cannot be rejected → 409', async () => {
    const record = await seed({
      title:       'Still drafting',
      description: 'Not reviewed yet',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await reject(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
      assert.ok(body.message);
    } finally {
      await cleanup(record.id);
    }
  });

  test('APPROVED cannot be rejected → 409', async () => {
    const record = await seed({
      title:       'Already approved',
      description: 'Already done',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await reject(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('REJECTED cannot be rejected again → 409', async () => {
    const record = await seed({
      title:       'Already rejected',
      description: 'Already done',
      status:      'REJECTED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await reject(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('CLOSED cannot be rejected → 409', async () => {
    const record = await seed({
      title:       'Closed change',
      description: 'Already closed',
      status:      'CLOSED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await reject(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('409 response does not expose internal details', async () => {
    const record = await seed({
      title:       'State check',
      description: 'Full description',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await reject(record.id);
      const serialised = JSON.stringify(body);
      assert.ok(!serialised.includes('stack'));
      assert.ok(!serialised.includes('/Users/'));
      assert.ok(!serialised.includes('Prisma'));
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Not found (404) ───────────────────────────────────────────────────────

  test('nonexistent valid UUID → 404', async () => {
    const { status, body } = await reject('00000000-0000-4000-8000-000000000000');
    assert.equal(status, 404);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Change request not found');
  });

  test('404 response does not expose stack trace or paths', async () => {
    const { body } = await reject('00000000-0000-4000-8000-000000000001');
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

  // ── Invalid UUID (400) ────────────────────────────────────────────────────

  test('invalid UUID → 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes/not-a-uuid/reject', {});
    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  // ── Client cannot supply fields on reject action (400) ────────────────────

  test('client-supplied status field is rejected', async () => {
    const record = await seed({
      title:       'Inject attempt',
      description: 'Valid description',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await reject(record.id, { status: 'REJECTED' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'status'));
      // Record must still be UNDER_REVIEW
      const unchanged = await prisma.changeRequest.findUnique({ where: { id: record.id } });
      assert.equal(unchanged.status, 'UNDER_REVIEW');
    } finally {
      await cleanup(record.id);
    }
  });

  test('client-supplied arbitrary field is rejected', async () => {
    const record = await seed({
      title:       'Arbitrary field',
      description: 'Valid description',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await reject(record.id, { foo: 'bar' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'foo'));
    } finally {
      await cleanup(record.id);
    }
  });

});
