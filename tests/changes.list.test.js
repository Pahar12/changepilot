'use strict';

/**
 * tests/changes.list.test.js
 *
 * Integration tests for GET /api/v1/changes.
 *
 * Strategy:
 *   - Shared PrismaClient from src/lib/prisma.js — same instance as the service.
 *   - A before() hook truncates the entire change_requests table once at suite
 *     start to remove any rows left by a prior incomplete run.
 *   - Each test seeds rows via Prisma directly and collects their IDs.
 *   - afterEach deletes only the seeded IDs so cleanup is targeted and
 *     guaranteed even when an assertion fails mid-test.
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

require('dotenv').config();

const app    = require('../app');
const prisma = require('../src/lib/prisma');

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * GET the given path+query from the running test server.
 * Returns { status, body } — body is parsed JSON or a raw string.
 */
function get(server, pathAndQuery) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path:     pathAndQuery,
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
  // Delete any rows left from previous incomplete runs before starting.
  // This only runs once at suite start, not between every test.
  await prisma.changeRequest.deleteMany({});

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

// ── Seed / cleanup ────────────────────────────────────────────────────────────

// All IDs seeded in the current test — deleted in afterEach.
let seededIds = [];

/**
 * Create a ChangeRequest directly via Prisma (bypasses HTTP validation so we
 * can seed specific status values like APPROVED that the POST endpoint forbids).
 */
async function seed(fields) {
  const record = await prisma.changeRequest.create({ data: fields });
  seededIds.push(record.id);
  return record;
}

afterEach(async () => {
  if (seededIds.length === 0) return;
  await prisma.changeRequest.deleteMany({ where: { id: { in: seededIds } } });
  seededIds = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/changes', () => {

  // ── Empty list ───────────────────────────────────────────────────────────────

  test('returns 200 with empty data array when no records exist', async () => {
    const { status, body } = await get(server, '/api/v1/changes');

    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 0);
    assert.ok(body.pagination);
    assert.equal(body.pagination.total, 0);
    assert.equal(body.pagination.totalPages, 0);
  });

  // ── Records returned ─────────────────────────────────────────────────────────

  test('returns all created records', async () => {
    await seed({ title: 'Change A', status: 'DRAFT',        riskLevel: 'LOW'    });
    await seed({ title: 'Change B', status: 'UNDER_REVIEW', riskLevel: 'MEDIUM' });
    await seed({ title: 'Change C', status: 'APPROVED',     riskLevel: 'HIGH'   });

    const { status, body } = await get(server, '/api/v1/changes');

    assert.equal(status, 200);
    assert.equal(body.data.length, 3);
  });

  test('each record has the expected shape', async () => {
    await seed({ title: 'Shape test', status: 'DRAFT', riskLevel: 'LOW' });

    const { body } = await get(server, '/api/v1/changes');
    const r = body.data[0];

    assert.ok(r.id);
    assert.ok(r.title);
    assert.ok(r.status);
    assert.ok(r.riskLevel);
    assert.ok(r.createdAt);
    assert.ok(r.updatedAt);
  });

  // ── Default ordering — newest first ──────────────────────────────────────────

  test('records are ordered by createdAt descending (newest first)', async () => {
    // Seed with a small delay between each to guarantee distinct createdAt values.
    const a = await seed({ title: 'Oldest', status: 'DRAFT', riskLevel: 'LOW' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await seed({ title: 'Middle', status: 'DRAFT', riskLevel: 'LOW' });
    await new Promise((r) => setTimeout(r, 5));
    const c = await seed({ title: 'Newest', status: 'DRAFT', riskLevel: 'LOW' });

    const { body } = await get(server, '/api/v1/changes');

    assert.equal(body.data[0].id, c.id, 'newest should be first');
    assert.equal(body.data[1].id, b.id);
    assert.equal(body.data[2].id, a.id, 'oldest should be last');
  });

  // ── Pagination ────────────────────────────────────────────────────────────────

  test('default pagination: page=1, limit=20', async () => {
    const { body } = await get(server, '/api/v1/changes');

    assert.equal(body.pagination.page,  1);
    assert.equal(body.pagination.limit, 20);
  });

  test('custom page and limit are respected', async () => {
    // Seed 3 records in order: first → oldest createdAt, last → newest createdAt.
    // With orderBy createdAt DESC, the list is: newest(P3), middle(P2), oldest(P1).
    // page=2, limit=2 skips the first 2 (P3, P2) and returns just P1.
    const p1 = await seed({ title: 'Pagination P1 oldest', status: 'DRAFT', riskLevel: 'LOW' });
    await new Promise((r) => setTimeout(r, 5));
    await seed({ title: 'Pagination P2 middle', status: 'DRAFT', riskLevel: 'LOW' });
    await new Promise((r) => setTimeout(r, 5));
    await seed({ title: 'Pagination P3 newest', status: 'DRAFT', riskLevel: 'LOW' });

    const { status, body } = await get(server, '/api/v1/changes?page=2&limit=2');

    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    // Descending order: newest first → page 2, limit 2 → the oldest record (P1)
    assert.equal(body.data[0].id, p1.id);
    assert.equal(body.pagination.page,  2);
    assert.equal(body.pagination.limit, 2);
  });

  test('total reflects matching records, not just current page', async () => {
    await seed({ title: 'T1', status: 'DRAFT', riskLevel: 'LOW' });
    await seed({ title: 'T2', status: 'DRAFT', riskLevel: 'LOW' });
    await seed({ title: 'T3', status: 'DRAFT', riskLevel: 'LOW' });

    const { body } = await get(server, '/api/v1/changes?limit=1');

    assert.equal(body.data.length, 1);
    assert.equal(body.pagination.total, 3);
    assert.equal(body.pagination.totalPages, 3);
  });

  test('totalPages is 0 when total is 0', async () => {
    const { body } = await get(server, '/api/v1/changes');

    assert.equal(body.pagination.total,      0);
    assert.equal(body.pagination.totalPages, 0);
  });

  test('page beyond available records returns empty data array', async () => {
    await seed({ title: 'Only record', status: 'DRAFT', riskLevel: 'LOW' });

    const { status, body } = await get(server, '/api/v1/changes?page=99&limit=20');

    assert.equal(status, 200);
    assert.equal(body.data.length, 0);
    assert.equal(body.pagination.total, 1);
  });

  // ── Filtering ─────────────────────────────────────────────────────────────────

  test('?status=DRAFT returns only DRAFT records', async () => {
    await seed({ title: 'Draft 1',    status: 'DRAFT',        riskLevel: 'LOW'  });
    await seed({ title: 'Draft 2',    status: 'DRAFT',        riskLevel: 'HIGH' });
    await seed({ title: 'Not draft',  status: 'UNDER_REVIEW', riskLevel: 'LOW'  });

    const { body } = await get(server, '/api/v1/changes?status=DRAFT');

    assert.equal(body.data.length, 2);
    body.data.forEach((r) => assert.equal(r.status, 'DRAFT'));
    assert.equal(body.pagination.total, 2);
  });

  test('?status=APPROVED returns only APPROVED records', async () => {
    await seed({ title: 'Approved',   status: 'APPROVED', riskLevel: 'LOW' });
    await seed({ title: 'Draft',      status: 'DRAFT',    riskLevel: 'LOW' });

    const { body } = await get(server, '/api/v1/changes?status=APPROVED');

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].status, 'APPROVED');
  });

  test('?riskLevel=CRITICAL returns only CRITICAL records', async () => {
    await seed({ title: 'Crit 1', status: 'DRAFT', riskLevel: 'CRITICAL' });
    await seed({ title: 'Crit 2', status: 'DRAFT', riskLevel: 'CRITICAL' });
    await seed({ title: 'Low',    status: 'DRAFT', riskLevel: 'LOW'      });

    const { body } = await get(server, '/api/v1/changes?riskLevel=CRITICAL');

    assert.equal(body.data.length, 2);
    body.data.forEach((r) => assert.equal(r.riskLevel, 'CRITICAL'));
    assert.equal(body.pagination.total, 2);
  });

  test('combined ?status=UNDER_REVIEW&riskLevel=HIGH uses AND semantics', async () => {
    await seed({ title: 'Match',         status: 'UNDER_REVIEW', riskLevel: 'HIGH'   });
    await seed({ title: 'Wrong risk',    status: 'UNDER_REVIEW', riskLevel: 'LOW'    });
    await seed({ title: 'Wrong status',  status: 'DRAFT',        riskLevel: 'HIGH'   });
    await seed({ title: 'Both wrong',    status: 'APPROVED',     riskLevel: 'MEDIUM' });

    const { body } = await get(server, '/api/v1/changes?status=UNDER_REVIEW&riskLevel=HIGH');

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].title, 'Match');
    assert.equal(body.pagination.total, 1);
  });

  test('combined filter with no matches returns empty array', async () => {
    await seed({ title: 'Only DRAFT LOW', status: 'DRAFT', riskLevel: 'LOW' });

    const { status, body } = await get(server, '/api/v1/changes?status=APPROVED&riskLevel=CRITICAL');

    assert.equal(status, 200);
    assert.equal(body.data.length, 0);
    assert.equal(body.pagination.total, 0);
  });

  // ── Query validation failures ─────────────────────────────────────────────────

  test('invalid status returns 400', async () => {
    const { status, body } = await get(server, '/api/v1/changes?status=PENDING');

    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(body.errors.some((e) => e.field === 'status'));
  });

  test('lowercase status is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?status=draft');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'status'));
  });

  test('invalid riskLevel returns 400', async () => {
    const { status, body } = await get(server, '/api/v1/changes?riskLevel=EXTREME');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
  });

  test('lowercase riskLevel is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?riskLevel=high');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'riskLevel'));
  });

  test('non-integer page is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?page=abc');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'page'));
  });

  test('page=0 is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?page=0');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'page'));
  });

  test('page=-1 is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?page=-1');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'page'));
  });

  test('non-integer limit is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?limit=xyz');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'limit'));
  });

  test('limit=0 is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?limit=0');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'limit'));
  });

  test('limit > 100 is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?limit=101');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'limit'));
  });

  test('limit=100 is accepted (boundary)', async () => {
    const { status, body } = await get(server, '/api/v1/changes?limit=100');

    assert.equal(status, 200);
    assert.equal(body.pagination.limit, 100);
  });

  test('unknown query parameter is rejected', async () => {
    const { status, body } = await get(server, '/api/v1/changes?foo=bar');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'foo'));
  });

  test('multiple unknown params all appear in errors', async () => {
    const { status, body } = await get(server, '/api/v1/changes?sort=title&order=asc');

    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'sort'));
    assert.ok(body.errors.some((e) => e.field === 'order'));
  });

  test('error response never contains a stack trace', async () => {
    const { body } = await get(server, '/api/v1/changes?status=BAD');
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'));
    assert.ok(!serialised.includes('/Users/'));
  });

  test('multiple validation errors are returned at once', async () => {
    const { status, body } = await get(server, '/api/v1/changes?status=BAD&riskLevel=BAD&page=0');

    assert.equal(status, 400);
    assert.ok(body.errors.length >= 3);
  });

});
