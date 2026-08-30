'use strict';

/**
 * tests/changes.post.test.js
 *
 * Integration tests for POST /api/v1/changes.
 *
 * Strategy:
 *   - Import the Express app directly and bind it to a random OS-assigned port.
 *   - Make real HTTP requests with node:http — no supertest, no extra deps.
 *   - All happy-path tests wrap assertions in try/finally so the created record
 *     is deleted from the database even if an assertion fails mid-test.
 *   - A single shared PrismaClient (from src/lib/prisma.js) is used by both
 *     the app and the test cleanup — one connection pool, disconnected once.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Load .env before requiring app (mirrors how server.js works)
require('dotenv').config();

const app = require('../app');

// Shared Prisma singleton — same instance the service uses.
// Disconnected once in after() so only one pool is ever open.
const prisma = require('../src/lib/prisma');
const { signToken } = require('../src/lib/jwt');
const { hashPassword } = require('../src/lib/crypto');
const env = require('../src/config/env');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * POST a JSON-serialisable payload and return { status, headers, body }.
 * body is parsed as JSON when possible, otherwise returned as raw string.
 */
function post(server, path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method:   'POST',
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

/**
 * POST a raw string body with application/json Content-Type.
 * Used to simulate malformed JSON that the body-parser will reject.
 */
function postRaw(server, path, rawBody) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(rawBody)
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
    req.write(rawBody);
    req.end();
  });
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;
let requesterUser;
let requesterToken;

before(() => {
  return prisma.user.deleteMany({}).then(async () => {
    const passwordHash = await hashPassword('TestPassword123');

    requesterUser = await prisma.user.create({
      data: {
        name: 'Requester One',
        email: 'changes-post-requester@example.com',
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
});

after(async () => {
  // Disconnect the shared Prisma client exactly once — this covers both the
  // service's pool and the cleanup calls in this file.
  await prisma.$disconnect();
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

// ── Cleanup helper ────────────────────────────────────────────────────────────

/**
 * Delete a ChangeRequest by id.
 * Swallows errors (record may not exist if the test failed before creation).
 */
async function cleanup(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/changes', () => {

  // ── Happy path — all wrap assertions in try/finally to guarantee cleanup ────

  test('valid body returns 201 with the created record', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:       'Upgrade payment service',
      description: 'Move from v2 to v3',
      riskLevel:   'HIGH'
    });

    assert.equal(status, 201);
    assert.equal(body.status, 'success');

    const r = body.data;
    try {
      assert.ok(r.id, 'id should be present');
      assert.equal(r.title, 'Upgrade payment service');
      assert.equal(r.description, 'Move from v2 to v3');
      assert.equal(r.status, 'DRAFT');
      assert.equal(r.riskLevel, 'HIGH');
      assert.equal(r.createdById, requesterUser.id);
      assert.ok(r.createdAt);
      assert.ok(r.updatedAt);
    } finally {
      await cleanup(r.id);
    }
  });

  test('status is always DRAFT regardless of anything', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: 'Status override attempt'
    });

    assert.equal(status, 201);
    try {
      assert.equal(body.data.status, 'DRAFT');
    } finally {
      await cleanup(body.data.id);
    }
  });

  test('riskLevel defaults to LOW when omitted', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: 'No risk level provided'
    });

    assert.equal(status, 201);
    try {
      assert.equal(body.data.riskLevel, 'LOW');
    } finally {
      await cleanup(body.data.id);
    }
  });

  test('supplied riskLevel MEDIUM is accepted', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:     'Medium risk change',
      riskLevel: 'MEDIUM'
    });

    assert.equal(status, 201);
    try {
      assert.equal(body.data.riskLevel, 'MEDIUM');
    } finally {
      await cleanup(body.data.id);
    }
  });

  test('supplied riskLevel CRITICAL is accepted', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:     'Critical change',
      riskLevel: 'CRITICAL'
    });

    assert.equal(status, 201);
    try {
      assert.equal(body.data.riskLevel, 'CRITICAL');
    } finally {
      await cleanup(body.data.id);
    }
  });

  test('title whitespace is trimmed', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: '  Trimmed title  '
    });

    assert.equal(status, 201);
    try {
      assert.equal(body.data.title, 'Trimmed title');
    } finally {
      await cleanup(body.data.id);
    }
  });

  test('description whitespace is trimmed', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:       'Desc trim test',
      description: '  leading and trailing  '
    });

    assert.equal(status, 201);
    try {
      assert.equal(body.data.description, 'leading and trailing');
    } finally {
      await cleanup(body.data.id);
    }
  });

  test('description is optional — omitting it returns null', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: 'No description'
    });

    assert.equal(status, 201);
    try {
      // Prisma returns null for an omitted nullable field
      assert.equal(body.data.description, null);
    } finally {
      await cleanup(body.data.id);
    }
  });

  // ── Validation failures — no DB records created, no cleanup needed ──────────

  test('missing title returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      description: 'no title here'
    });

    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.field === 'title'));
  });

  test('empty string title returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: ''
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'title'));
  });

  test('whitespace-only title returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: '   '
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'title'));
  });

  test('title exceeding 100 characters returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: 'x'.repeat(101)
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'title'));
  });

  test('non-string title returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: 42
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'title'));
  });

  test('invalid riskLevel returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:     'Bad risk',
      riskLevel: 'EXTREME'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
  });

  test('lowercase riskLevel returns 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:     'Case check',
      riskLevel: 'high'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
  });

  test('supplying status is rejected as unknown field', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:  'Inject status',
      status: 'APPROVED'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'status'));
  });

  test('supplying id is rejected as unknown field', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title: 'Inject id',
      id:    'fake-uuid'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  test('supplying createdAt is rejected as unknown field', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:     'Inject createdAt',
      createdAt: '2020-01-01'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'createdAt'));
  });

  test('supplying updatedAt is rejected as unknown field', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:     'Inject updatedAt',
      updatedAt: '2020-01-01'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'updatedAt'));
  });

  test('unknown field is rejected', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      title:       'Good title',
      hackerField: 'payload'
    });

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'hackerField'));
  });

  test('multiple errors returned at once', async () => {
    const { status, body } = await post(server, '/api/v1/changes', {
      riskLevel: 'EXTREME',
      status:    'APPROVED',
      id:        'fake'
    });

    assert.equal(status, 400);
    // title missing + riskLevel invalid + status forbidden + id forbidden = ≥4
    assert.ok(body.errors.length >= 4);
  });

  test('validation error response never exposes a stack trace', async () => {
    const { body } = await post(server, '/api/v1/changes', { title: '' });
    assert.equal(body.stack, undefined);
    assert.equal(body.stackTrace, undefined);
  });

  // ── Error handler — malformed JSON ─────────────────────────────────────────
  //
  // body-parser rejects the request before it reaches any route handler and
  // calls next(err) with err.type === 'entity.parse.failed'.
  // The global error handler must catch this and return a clean JSON 400.

  test('malformed JSON returns 400 JSON with "Invalid JSON" message', async () => {
    const { status, headers, body } = await postRaw(
      server,
      '/api/v1/changes',
      '{this is not valid json}'
    );

    assert.equal(status, 400);

    // Response must be application/json — not text/html
    assert.ok(
      (headers['content-type'] || '').includes('application/json'),
      `Expected application/json, got: ${headers['content-type']}`
    );

    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Invalid JSON');

    // Must not contain any internal detail
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'), 'response must not contain "stack"');
    assert.ok(!serialised.includes('/Users/'), 'response must not contain filesystem paths');
    assert.ok(!serialised.includes('node_modules'), 'response must not contain node_modules paths');
  });

});
