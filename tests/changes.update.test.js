'use strict';

/**
 * tests/changes.update.test.js
 *
 * Integration tests for PATCH /api/v1/changes/:id.
 *
 * Strategy:
 *   - Shared PrismaClient from src/lib/prisma.js — same instance as the service.
 *   - before() truncates the change_requests table to remove stale rows from
 *     any prior incomplete run.
 *   - Each test that creates a record wraps assertions in try/finally and
 *     deletes the record in the finally block.
 *   - Validation-only tests that never reach the DB need no cleanup.
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

/** PATCH a path with a JSON payload. Returns { status, headers, body }. */
function patch(server, path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method:   'PATCH',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization:    `Bearer ${requesterToken}`
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
let requesterToken;

before(async () => {
  await prisma.user.deleteMany({});
  await prisma.changeRequest.deleteMany({});

  const passwordHash = await hashPassword('TestPassword123');

  requesterUser = await prisma.user.create({
    data: {
      name: 'Requester One',
      email: 'changes-update-requester@example.com',
      passwordHash,
      role: 'REQUESTER'
    }
  });

  requesterToken = signToken(
    { userId: requesterUser.id, email: requesterUser.email, role: requesterUser.role },
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

/** Convenience: patch a change and return the response. */
function update(id, payload) {
  return patch(server, `/api/v1/changes/${id}`, payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/changes/:id', () => {

  // ── Success — individual fields ───────────────────────────────────────────

  test('PATCH title on a DRAFT record → 200', async () => {
    const record = await seed({ title: 'Original', description: 'Desc', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status } = await update(record.id, { title: 'Updated title' });
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('PATCH description → 200', async () => {
    const record = await seed({ title: 'Title', description: 'Old desc', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status } = await update(record.id, { description: 'New description' });
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('PATCH riskLevel → 200', async () => {
    const record = await seed({ title: 'Title', description: 'Desc', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status } = await update(record.id, { riskLevel: 'CRITICAL' });
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('PATCH multiple editable fields → 200', async () => {
    const record = await seed({ title: 'Old', description: 'Old desc', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 'New', riskLevel: 'HIGH' });
      assert.equal(status, 200);
      assert.equal(body.data.title, 'New');
      assert.equal(body.data.riskLevel, 'HIGH');
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Success — field-level correctness ────────────────────────────────────

  test('omitted fields remain unchanged', async () => {
    const record = await seed({ title: 'Keep me', description: 'Keep desc', status: 'DRAFT', riskLevel: 'MEDIUM' });
    try {
      const { body } = await update(record.id, { title: 'New title' });
      // description and riskLevel must be unchanged
      assert.equal(body.data.description, 'Keep desc');
      assert.equal(body.data.riskLevel,   'MEDIUM');
    } finally {
      await cleanup(record.id);
    }
  });

  test('surrounding whitespace in title is trimmed', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { title: '  Trimmed  ' });
      assert.equal(body.data.title, 'Trimmed');
    } finally {
      await cleanup(record.id);
    }
  });

  test('surrounding whitespace in description is trimmed', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { description: '  spaces  ' });
      assert.equal(body.data.description, 'spaces');
    } finally {
      await cleanup(record.id);
    }
  });

  test('updatedAt changes after a successful PATCH', async () => {
    const record = await seed({ title: 'Title', description: 'Desc', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      await new Promise((r) => setTimeout(r, 5));
      const { body } = await update(record.id, { title: 'New title' });
      assert.notEqual(
        new Date(body.data.updatedAt).getTime(),
        new Date(record.updatedAt).getTime()
      );
    } finally {
      await cleanup(record.id);
    }
  });

  test('id remains unchanged after PATCH', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { title: 'New title' });
      assert.equal(body.data.id, record.id);
    } finally {
      await cleanup(record.id);
    }
  });

  test('status remains DRAFT after PATCH', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { title: 'New title' });
      assert.equal(body.data.status, 'DRAFT');
    } finally {
      await cleanup(record.id);
    }
  });

  test('createdAt is unchanged after PATCH', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { title: 'New title' });
      assert.equal(
        new Date(body.data.createdAt).getTime(),
        new Date(record.createdAt).getTime()
      );
    } finally {
      await cleanup(record.id);
    }
  });

  test('response has the expected object shape', async () => {
    const record = await seed({ title: 'Shape test', description: 'Desc', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { title: 'New shape' });
      const d = body.data;
      assert.ok('id'          in d, 'missing id');
      assert.ok('title'       in d, 'missing title');
      assert.ok('description' in d, 'missing description');
      assert.ok('status'      in d, 'missing status');
      assert.ok('riskLevel'   in d, 'missing riskLevel');
      assert.ok('createdAt'   in d, 'missing createdAt');
      assert.ok('updatedAt'   in d, 'missing updatedAt');
    } finally {
      await cleanup(record.id);
    }
  });

  test('response Content-Type is application/json', async () => {
    const record = await seed({ title: 'Content-type', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { headers } = await update(record.id, { title: 'Check header' });
      assert.ok(
        (headers['content-type'] || '').includes('application/json'),
        `Expected application/json, got: ${headers['content-type']}`
      );
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Validation — invalid UUID ─────────────────────────────────────────────

  test('invalid UUID → 400', async () => {
    const { status, body } = await patch(server, '/api/v1/changes/not-a-uuid', { title: 'x' });
    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  test('SQL-injection-shaped UUID is rejected → 400', async () => {
    // node:http rejects raw unescaped characters — use a percent-encoded path
    // (same approach as the existing get-by-id test suite).
    const { status, body } = await patch(server, '/api/v1/changes/1%27+OR+%271%27%3D%271', { title: 'x' });
    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  // ── Validation — not found ────────────────────────────────────────────────

  test('nonexistent valid UUID → 404', async () => {
    const { status, body } = await update('00000000-0000-4000-8000-000000000000', { title: 'x' });
    assert.equal(status, 404);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Change request not found');
  });

  // ── Validation — body ─────────────────────────────────────────────────────

  test('empty body {} → 400', async () => {
    // Need a real record so the 404 path isn't hit before body validation
    const record = await seed({ title: 'For empty body test', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, {});
      assert.equal(status, 400);
      assert.equal(body.status, 'fail');
      assert.ok(Array.isArray(body.errors));
      assert.ok(body.errors.some((e) => e.field === 'body'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('unknown field → 400', async () => {
    const record = await seed({ title: 'Unknown field', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { foo: 'bar' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'foo'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('status field → 400', async () => {
    const record = await seed({ title: 'Status inject', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { status: 'APPROVED' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'status'));
      // Must not have changed
      const unchanged = await prisma.changeRequest.findUnique({ where: { id: record.id } });
      assert.equal(unchanged.status, 'DRAFT');
    } finally {
      await cleanup(record.id);
    }
  });

  test('id field → 400', async () => {
    const record = await seed({ title: 'ID inject', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { id: '00000000-0000-4000-8000-000000000099' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'id'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('createdAt field → 400', async () => {
    const record = await seed({ title: 'CreatedAt inject', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { createdAt: new Date().toISOString() });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'createdAt'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('updatedAt field → 400', async () => {
    const record = await seed({ title: 'UpdatedAt inject', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { updatedAt: new Date().toISOString() });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'updatedAt'));
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Validation — title ────────────────────────────────────────────────────

  test('title empty string → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status } = await update(record.id, { title: '' });
      assert.equal(status, 400);
    } finally {
      await cleanup(record.id);
    }
  });

  test('title whitespace-only → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: '   ' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'title'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('title > 100 characters → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 'A'.repeat(101) });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'title'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('title non-string (number) → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 42 });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'title'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('title null value → 400 with title error', async () => {
    // typeof null === 'object' — verify the type guard catches this
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: null });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'title'), 'errors must include title');
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Validation — description ──────────────────────────────────────────────

  test('description non-string (number) → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { description: 99 });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'description'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('description null value → 400 with description error', async () => {
    // typeof null === 'object' — verify the type guard catches this
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { description: null });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'description'), 'errors must include description');
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Validation — riskLevel ────────────────────────────────────────────────

  test('invalid riskLevel → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { riskLevel: 'EXTREME' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('lowercase riskLevel → 400', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { riskLevel: 'high' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
    } finally {
      await cleanup(record.id);
    }
  });

  // ── State — wrong status (409) ────────────────────────────────────────────

  test('UNDER_REVIEW cannot be edited → 409', async () => {
    const record = await seed({ title: 'Under review', description: 'Desc', status: 'UNDER_REVIEW', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 'Hack' });
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
      assert.ok(body.message);
    } finally {
      await cleanup(record.id);
    }
  });

  test('APPROVED cannot be edited → 409', async () => {
    const record = await seed({ title: 'Approved', description: 'Desc', status: 'APPROVED', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 'Hack' });
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('REJECTED cannot be edited → 409', async () => {
    const record = await seed({ title: 'Rejected', description: 'Desc', status: 'REJECTED', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 'Hack' });
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('CLOSED cannot be edited → 409', async () => {
    const record = await seed({ title: 'Closed', description: 'Desc', status: 'CLOSED', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { title: 'Hack' });
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('failed update (wrong status) does not modify the record', async () => {
    const record = await seed({ title: 'Original title', description: 'Desc', status: 'UNDER_REVIEW', riskLevel: 'LOW' });
    try {
      await update(record.id, { title: 'Should not stick' });
      const unchanged = await prisma.changeRequest.findUnique({ where: { id: record.id } });
      assert.equal(unchanged.title,  'Original title');
      assert.equal(unchanged.status, 'UNDER_REVIEW');
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Persistence verification ──────────────────────────────────────────────

  test('successful PATCH — status in DB is still DRAFT (not just in response)', async () => {
    const record = await seed({ title: 'DB verify', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      await update(record.id, { title: 'DB-verified title' });
      const inDb = await prisma.changeRequest.findUnique({ where: { id: record.id } });
      assert.equal(inDb.status, 'DRAFT');
      assert.equal(inDb.title,  'DB-verified title');
    } finally {
      await cleanup(record.id);
    }
  });

  test('multiple unknown fields all appear in errors array', async () => {
    const record = await seed({ title: 'Multi unknown', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { foo: 'x', bar: 'y', status: 'APPROVED' });
      assert.equal(status, 400);
      const fields = body.errors.map((e) => e.field);
      assert.ok(fields.includes('foo'),    'missing foo error');
      assert.ok(fields.includes('bar'),    'missing bar error');
      assert.ok(fields.includes('status'), 'missing status error');
    } finally {
      await cleanup(record.id);
    }
  });

  test('riskLevel null value → 400 with riskLevel error', async () => {
    const record = await seed({ title: 'Title', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status, body } = await update(record.id, { riskLevel: null });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'riskLevel'), 'errors must include riskLevel');
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Security ──────────────────────────────────────────────────────────────

  test('error responses do not expose stack traces or filesystem paths', async () => {
    const record = await seed({ title: 'Security', description: 'Desc', status: 'UNDER_REVIEW', riskLevel: 'LOW' });
    try {
      const { body } = await update(record.id, { title: 'Attempt' });
      const serialised = JSON.stringify(body);
      assert.ok(!serialised.includes('stack'));
      assert.ok(!serialised.includes('/Users/'));
      assert.ok(!serialised.includes('Prisma'));
      assert.ok(!serialised.includes('DATABASE_URL'));
    } finally {
      await cleanup(record.id);
    }
  });

  test('validation error response does not expose stack traces', async () => {
    const { body } = await patch(server, '/api/v1/changes/bad-id', { title: 'x' });
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

});
