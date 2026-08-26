'use strict';

/**
 * tests/changes.close.test.js
 *
 * Integration tests for POST /api/v1/changes/:id/close.
 *
 * Allowed source statuses: APPROVED, REJECTED → CLOSED
 *
 * Strategy: same as approve/reject — before() truncates, try/finally cleanup.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

require('dotenv').config();

const app    = require('../app');
const prisma = require('../src/lib/prisma');

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

async function seed(fields) {
  return prisma.changeRequest.create({ data: fields });
}

async function cleanup(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

function close(id, body) {
  return post(server, `/api/v1/changes/${id}/close`, body !== undefined ? body : {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/changes/:id/close', () => {

  // ── Happy path — from APPROVED ────────────────────────────────────────────

  test('APPROVED → CLOSED returns 200', async () => {
    const record = await seed({
      title:       'Close from approved',
      description: 'Approved and done',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { status } = await close(record.id);
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned status is CLOSED (from APPROVED)', async () => {
    const record = await seed({
      title:       'Status check approved',
      description: 'Valid description',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await close(record.id);
      assert.equal(body.data.status, 'CLOSED');
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Happy path — from REJECTED ────────────────────────────────────────────

  test('REJECTED → CLOSED returns 200', async () => {
    const record = await seed({
      title:       'Close from rejected',
      description: 'Rejected and done',
      status:      'REJECTED',
      riskLevel:   'LOW'
    });
    try {
      const { status } = await close(record.id);
      assert.equal(status, 200);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned status is CLOSED (from REJECTED)', async () => {
    const record = await seed({
      title:       'Status check rejected',
      description: 'Valid description',
      status:      'REJECTED',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await close(record.id);
      assert.equal(body.data.status, 'CLOSED');
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned ID remains unchanged', async () => {
    const record = await seed({
      title:       'ID stability',
      description: 'Some description',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { body } = await close(record.id);
      assert.equal(body.data.id, record.id);
    } finally {
      await cleanup(record.id);
    }
  });

  test('returned title and description remain unchanged', async () => {
    const record = await seed({
      title:       'Unchanged fields',
      description: 'Original description',
      status:      'APPROVED',
      riskLevel:   'MEDIUM'
    });
    try {
      const { body } = await close(record.id);
      assert.equal(body.data.title,       'Unchanged fields');
      assert.equal(body.data.description, 'Original description');
    } finally {
      await cleanup(record.id);
    }
  });

  test('updatedAt changes after close', async () => {
    const record = await seed({
      title:       'Timestamp test',
      description: 'Check timestamp',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      await new Promise((r) => setTimeout(r, 5));
      const { body } = await close(record.id);
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
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { headers } = await close(record.id);
      assert.ok(
        (headers['content-type'] || '').includes('application/json'),
        `Expected application/json, got: ${headers['content-type']}`
      );
    } finally {
      await cleanup(record.id);
    }
  });

  // ── Wrong status (409) ────────────────────────────────────────────────────

  test('DRAFT cannot be closed → 409', async () => {
    const record = await seed({
      title:       'Still drafting',
      description: 'Not reviewed yet',
      status:      'DRAFT',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await close(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
      assert.ok(body.message);
    } finally {
      await cleanup(record.id);
    }
  });

  test('UNDER_REVIEW cannot be closed → 409', async () => {
    const record = await seed({
      title:       'Under review',
      description: 'Still under review',
      status:      'UNDER_REVIEW',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await close(record.id);
      assert.equal(status, 409);
      assert.equal(body.status, 'fail');
    } finally {
      await cleanup(record.id);
    }
  });

  test('CLOSED cannot be closed again → 409', async () => {
    const record = await seed({
      title:       'Already closed',
      description: 'Already done',
      status:      'CLOSED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await close(record.id);
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
      const { body } = await close(record.id);
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
    const { status, body } = await close('00000000-0000-4000-8000-000000000000');
    assert.equal(status, 404);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Change request not found');
  });

  test('404 response does not expose stack trace or paths', async () => {
    const { body } = await close('00000000-0000-4000-8000-000000000001');
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

  // ── Invalid UUID (400) ────────────────────────────────────────────────────

  test('invalid UUID → 400', async () => {
    const { status, body } = await post(server, '/api/v1/changes/not-a-uuid/close', {});
    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e) => e.field === 'id'));
  });

  // ── Client cannot supply fields on close action (400) ─────────────────────

  test('client-supplied status field is rejected', async () => {
    const record = await seed({
      title:       'Inject attempt',
      description: 'Valid description',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await close(record.id, { status: 'CLOSED' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'status'));
      // Record must still be APPROVED
      const unchanged = await prisma.changeRequest.findUnique({ where: { id: record.id } });
      assert.equal(unchanged.status, 'APPROVED');
    } finally {
      await cleanup(record.id);
    }
  });

  test('client-supplied arbitrary field is rejected', async () => {
    const record = await seed({
      title:       'Arbitrary field',
      description: 'Valid description',
      status:      'APPROVED',
      riskLevel:   'LOW'
    });
    try {
      const { status, body } = await close(record.id, { foo: 'bar' });
      assert.equal(status, 400);
      assert.ok(body.errors.some((e) => e.field === 'foo'));
    } finally {
      await cleanup(record.id);
    }
  });

});
