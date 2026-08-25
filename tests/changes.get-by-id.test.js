'use strict';

/**
 * tests/changes.get-by-id.test.js
 *
 * Integration tests for GET /api/v1/changes/:id.
 *
 * Strategy:
 *   - Shared PrismaClient from src/lib/prisma.js — same instance as the service.
 *   - A before() hook truncates the entire change_requests table once at suite
 *     start to remove any rows left by a prior incomplete run.
 *   - Each happy-path test creates one record, wraps assertions in try/finally,
 *     and deletes the record in the finally block.
 *   - Validation-only tests never reach the database — no cleanup needed.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

require('dotenv').config();

const app    = require('../app');
const prisma = require('../src/lib/prisma');

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * GET the given path from the running test server.
 * Returns { status, headers, body } — body is parsed JSON or a raw string.
 */
function get(server, path) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method:   'GET'
    };

    http.get(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: raw });
        }
      });
    }).on('error', reject);
  });
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

before(async () => {
  // Remove any rows left by a prior incomplete run.
  await prisma.changeRequest.deleteMany({});

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await prisma.$disconnect();
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ── Seed helper ───────────────────────────────────────────────────────────────

/**
 * Create a ChangeRequest directly via Prisma and return the record.
 * Callers are responsible for cleanup (try/finally pattern).
 */
async function seed(fields) {
  return prisma.changeRequest.create({ data: fields });
}

async function cleanup(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/changes/:id', () => {

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 for an existing change', async () => {
    const record = await seed({ title: 'Existing change', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { status } = await get(server, `/api/v1/changes/${record.id}`);
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('response wraps the record in a data field', async () => {
    const record = await seed({ title: 'Data field test', status: 'DRAFT', riskLevel: 'MEDIUM' });
    try {
      const { body } = await get(server, `/api/v1/changes/${record.id}`);
      assert.ok(body.data, 'response must have a data field');
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned object has all expected fields', async () => {
    const record = await seed({
      title:       'Field shape test',
      description: 'Full shape',
      status:      'UNDER_REVIEW',
      riskLevel:   'HIGH'
    });
    try {
      const { body } = await get(server, `/api/v1/changes/${record.id}`);
      const r = body.data;
      assert.ok(r.id,        'id must be present');
      assert.ok(r.title,     'title must be present');
      assert.ok(r.status,    'status must be present');
      assert.ok(r.riskLevel, 'riskLevel must be present');
      assert.ok(r.createdAt, 'createdAt must be present');
      assert.ok(r.updatedAt, 'updatedAt must be present');
      // description may be null or a string — it must be present as a key
      assert.ok(Object.hasOwn(r, 'description'), 'description key must be present');
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned record id matches the requested id', async () => {
    const record = await seed({ title: 'ID match test', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { body } = await get(server, `/api/v1/changes/${record.id}`);
      assert.equal(body.data.id, record.id);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned record fields match seeded values', async () => {
    const record = await seed({
      title:       'Values match test',
      description: 'Check all values',
      status:      'APPROVED',
      riskLevel:   'CRITICAL'
    });
    try {
      const { body } = await get(server, `/api/v1/changes/${record.id}`);
      const r = body.data;
      assert.equal(r.title,       'Values match test');
      assert.equal(r.description, 'Check all values');
      assert.equal(r.status,      'APPROVED');
      assert.equal(r.riskLevel,   'CRITICAL');
    } finally {
      await cleanup(record.id);
    }
  });

  test('response Content-Type is application/json', async () => {
    const record = await seed({ title: 'Content-type test', status: 'DRAFT', riskLevel: 'LOW' });
    try {
      const { headers } = await get(server, `/api/v1/changes/${record.id}`);
      assert.ok(
        (headers['content-type'] || '').includes('application/json'),
        `Expected application/json, got: ${headers['content-type']}`
      );
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Not found ──────────────────────────────────────────────────────────────
  // Uses a well-formed UUID that does not exist in the database.
  // No DB record is created — no cleanup needed.

  test('returns 404 for a valid UUID that does not exist', async () => {
    const { status } = await get(
      server,
      '/api/v1/changes/00000000-0000-4000-8000-000000000000'
    );
    assert.equal(status, 404);
  });

  test('404 response has status "fail" and a message field', async () => {
    const { body } = await get(
      server,
      '/api/v1/changes/00000000-0000-4000-8000-000000000001'
    );
    assert.equal(body.status,  'fail');
    assert.equal(body.message, 'Change request not found');
  });

  test('404 response does not expose a stack trace', async () => {
    const { body } = await get(
      server,
      '/api/v1/changes/00000000-0000-4000-8000-000000000002'
    );
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'),      '404 must not contain "stack"');
    assert.ok(!serialised.includes('/Users/'),     '404 must not contain filesystem paths');
    assert.ok(!serialised.includes('node_modules'), '404 must not contain node_modules paths');
  });

  // ── Invalid ID — validation layer (400) ───────────────────────────────────
  // The validateParam middleware rejects these before they reach the service.

  test('non-UUID id returns 400', async () => {
    const { status, body } = await get(server, '/api/v1/changes/not-a-uuid');
    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  test('short numeric id returns 400', async () => {
    const { status, body } = await get(server, '/api/v1/changes/12345');
    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  test('SQL-injection-shaped id returns 400', async () => {
    // Percent-encode the apostrophe so the HTTP path is legal.
    const { status, body } = await get(server, '/api/v1/changes/1%27%20OR%201%3D1');
    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  test('400 response does not expose a stack trace', async () => {
    const { body } = await get(server, '/api/v1/changes/bad-id');
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

  test('400 response Content-Type is application/json', async () => {
    const { headers } = await get(server, '/api/v1/changes/bad-id');
    assert.ok(
      (headers['content-type'] || '').includes('application/json'),
      `Expected application/json, got: ${headers['content-type']}`
    );
  });

});
