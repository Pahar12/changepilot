'use strict';

/**
 * tests/changes.submit.test.js
 *
 * Integration tests for POST /api/v1/changes/:id/submit.
 *
 * Strategy:
 *   - Shared PrismaClient from src/lib/prisma.js — same instance as the service.
 *   - A before() hook truncates the entire change_requests table once at suite
 *     start to remove any rows left by a prior incomplete run.
 *   - Each test that creates a record wraps assertions in try/finally and
 *     deletes the record in the finally block.
 *   - Validation-only tests never reach the database — no cleanup needed.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

require('dotenv').config();

const app    = require('../app');
const prisma = require('../src/lib/prisma');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/** POST to a path with optional JSON payload. Returns { status, headers, body }. */
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
        'Content-Length': Buffer.byteLength(data)
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

// ── Seed / cleanup helpers ────────────────────────────────────────────────────

/** Create a ChangeRequest directly via Prisma. Caller owns cleanup. */
async function seed(fields) {
  return prisma.changeRequest.create({ data: fields });
}

async function cleanup(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

/** Convenience: submit a change and return the response. */
function submit(id, body) {
  return post(server, `/api/v1/changes/${id}/submit`, body !== undefined ? body : {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/changes/:id/submit', () => {

  // ── Happy path ────────────────────────────────────────────────────────────

  test('DRAFT with valid description → 200', async () => {
    const record = await seed({
      title:       'Submit me',
      description: 'A detailed description of the change',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status } = await submit(record.id);
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned status is UNDER_REVIEW', async () => {
    const record = await seed({
      title:       'Status check',
      description: 'Valid description',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await submit(record.id);
      assert.equal(body.data.status, 'UNDER_REVIEW');
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned ID remains unchanged', async () => {
    const record = await seed({
      title:       'ID stability',
      description: 'Some description',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await submit(record.id);
      assert.equal(body.data.id, record.id);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned title and description remain unchanged', async () => {
    const record = await seed({
      title:       'Unchanged fields',
      description: 'Original description',
      status:      'DRAFT',
      riskLevel:   'MEDIUM'
    });
    try {
      const { body } = await submit(record.id);
      assert.equal(body.data.title,       'Unchanged fields');
      assert.equal(body.data.description, 'Original description');
    } finally {
      await cleanup(record.id);
    }
  });

  test('updatedAt changes after submit', async () => {
    const record = await seed({
      title:       'Timestamp test',
      description: 'Check timestamp',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      // Small delay to guarantee a different millisecond timestamp.
      await new Promise((r) => setTimeout(r, 5));
      const { body } = await submit(record.id);
      assert.notEqual(
        new Date(body.data.updatedAt).getTime(),
        new Date(record.updatedAt).getTime()
      );
    } finally {
      await cleanup(record.id);
    }
  });

  test('description with surrounding whitespace is accepted (trimmed check)', async () => {
    // The stored description has whitespace — the service trims before the blank check.
    const record = await seed({
      title:       'Whitespace description',
      description: '  Has content  ',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status } = await submit(record.id);
      // '  Has content  '.trim() is not empty → should succeed
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('response Content-Type is application/json', async () => {
    const record = await seed({
      title:       'Content-type',
      description: 'Check header',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { headers } = await submit(record.id);
      assert.ok(
        (headers['content-type'] || '').includes('application/json'),
        `Expected application/json, got: ${headers['content-type']}`
      );
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Missing / blank description (400) ─────────────────────────────────────

  test('null description returns 400', async () => {
    const record = await seed({
      title:    'No description',
      status:   'DRAFT',
      riskLevel:'LOW'
      // description intentionally omitted → stored as null
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 400);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('empty string description returns 400', async () => {
    const record = await seed({
      title:       'Empty description',
      description: '',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 400);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('whitespace-only description returns 400', async () => {
    const record = await seed({
      title:       'Whitespace only',
      description: '   ',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 400);
      assert.equal(body.status, 'fail');
      // Error must reference the description field
      assert.ok(
        body.errors && body.errors.some((e) => e.field === 'description'),
        'errors must include a description field error'
      );
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Wrong status (409) ────────────────────────────────────────────────────

  test('UNDER_REVIEW cannot be submitted again → 409', async () => {
    const record = await seed({
      title:       'Already reviewing',
      description: 'Full description',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
      assert.ok(body.message);
    } finally {
      await cleanup(record.id);
    }
  });

  test('APPROVED cannot be submitted → 409', async () => {
    const record = await seed({
      title:       'Already approved',
      description: 'Full description',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('REJECTED cannot be submitted → 409', async () => {
    const record = await seed({
      title:       'Rejected change',
      description: 'Full description',
      status:      'REJECTED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('CLOSED cannot be submitted → 409', async () => {
    const record = await seed({
      title:       'Closed change',
      description: 'Full description',
      status:      'CLOSED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('409 response message does not expose internal details', async () => {
    const record = await seed({
      title:       'State check',
      description: 'Full description',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await submit(record.id);
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
    const { status, body } = await submit('00000000-0000-4000-8000-000000000000');
    assert.equal(status, 404);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Change request not found');
  });

  test('404 response does not expose stack trace or paths', async () => {
    const { body } = await submit('00000000-0000-4000-8000-000000000001');
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

  // ── Invalid UUID (400) ────────────────────────────────────────────────────

  test('invalid UUID → 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes/not-a-uuid/submit', {});
    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  test('invalid UUID 400 response does not expose stack or paths', async () => {
    const { body } = await post(server, '/api/v1/changes/bad-id/submit', {});
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

  // ── Client cannot supply fields on submit action (400) ────────────────────

  test('client-supplied status field is rejected', async () => {
    const record = await seed({
      title:       'Inject attempt',
      description: 'Valid description',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id, { status: 'APPROVED' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'status'));
      // Record must still be DRAFT — the injection attempt must not have succeeded
      const unchanged = await prisma.changeRequest.findUnique({ where: { id: record.id } });
      assert.equal(unchanged.status, 'DRAFT');
    } finally {
      await cleanup(record.id);
    }
  });

  test('client-supplied arbitrary field is rejected', async () => {
    const record = await seed({
      title:       'Arbitrary field',
      description: 'Valid description',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await submit(record.id, { foo: 'bar' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'foo'));
    } finally {
      await cleanup(record.id);
    }
  });

});
