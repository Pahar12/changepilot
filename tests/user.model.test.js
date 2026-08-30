'use strict';

/**
 * tests/user.model.test.js
 *
 * Database integration tests for User model and ChangeRequest ownership relation.
 *
 * Strategy:
 *   - Shared PrismaClient from src/lib/prisma.js.
 *   - Integration tests at the Prisma/database layer.
 *   - Each test wraps assertions in try/finally and deletes created records in reverse
 *     foreign-key order (ChangeRequests first, Users second) to prevent constraint errors.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const prisma = require('../src/lib/prisma');

// ── Cleanup helpers ───────────────────────────────────────────────────────────

async function cleanupChange(id) {
  if (!id) return;
  await prisma.changeRequest.delete({ where: { id } }).catch(() => {});
}

async function cleanupUser(id) {
  if (!id) return;
  await prisma.user.delete({ where: { id } }).catch(() => {});
}

// ── Suite lifecycle ───────────────────────────────────────────────────────────

before(async () => {
  // Clean up any stale test records from previous incomplete runs
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});
});

after(async () => {
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('User Model & Ownership Database Foundation', () => {

  // ── Test 1: Default User Role ──────────────────────────────────────────────
  test('creates user with default role REQUESTER and persists required fields', async () => {
    let user;
    try {
      user = await prisma.user.create({
        data: {
          name:         'Alice Developer',
          email:        'alice.dev@example.com',
          passwordHash: '$2b$12$e8Y4e3f...dummyhash'
        }
      });

      assert.ok(user.id, 'User ID should be generated');
      assert.equal(user.name, 'Alice Developer');
      assert.equal(user.email, 'alice.dev@example.com');
      assert.equal(user.passwordHash, '$2b$12$e8Y4e3f...dummyhash');
      assert.equal(user.role, 'REQUESTER', 'Default role should be REQUESTER');
      assert.ok(user.createdAt instanceof Date, 'createdAt should be a Date');
      assert.ok(user.updatedAt instanceof Date, 'updatedAt should be a Date');
    } finally {
      if (user?.id) await cleanupUser(user.id);
    }
  });

  // ── Test 2: Unique Email Constraint ────────────────────────────────────────
  test('rejects creating a user with a duplicate email address', async () => {
    let user1;
    const email = 'duplicate.test@example.com';

    try {
      user1 = await prisma.user.create({
        data: {
          name:         'First User',
          email,
          passwordHash: '$2b$12$dummyhash1'
        }
      });

      assert.ok(user1.id);

      await assert.rejects(
        async () => {
          await prisma.user.create({
            data: {
              name:         'Second User',
              email,
              passwordHash: '$2b$12$dummyhash2'
            }
          });
        },
        (err) => {
          // Prisma unique constraint violation code is P2002
          assert.equal(err.code, 'P2002');
          return true;
        }
      );
    } finally {
      if (user1?.id) await cleanupUser(user1.id);
    }
  });

  // ── Test 3: Backward Compatibility (ChangeRequest without owner) ───────────
  test('allows creating ChangeRequest without createdById (nullable owner)', async () => {
    let change;
    try {
      change = await prisma.changeRequest.create({
        data: {
          title:       'Legacy Change Request without Owner',
          description: 'Created without owner reference',
          riskLevel:   'LOW',
          status:      'DRAFT'
        }
      });

      assert.ok(change.id, 'ChangeRequest should be created');
      assert.equal(change.createdById, null, 'createdById should default to null');
      assert.equal(change.title, 'Legacy Change Request without Owner');
    } finally {
      if (change?.id) await cleanupChange(change.id);
    }
  });

  // ── Test 4: User → ChangeRequest Ownership Relation ────────────────────────
  test('links ChangeRequest to User and resolves relation bidirectionally', async () => {
    let user;
    let change;

    try {
      // 1. Create owner user
      user = await prisma.user.create({
        data: {
          name:         'Bob Requester',
          email:        'bob.requester@example.com',
          passwordHash: '$2b$12$dummyhashbob',
          role:         'REQUESTER'
        }
      });

      // 2. Create ChangeRequest linked to user via createdById
      change = await prisma.changeRequest.create({
        data: {
          title:       'Add caching layer',
          description: 'Improve response latency with Redis caching',
          riskLevel:   'MEDIUM',
          status:      'DRAFT',
          createdById: user.id
        }
      });

      assert.equal(change.createdById, user.id, 'createdById must match user id');

      // 3. Verify fetching ChangeRequest with createdBy relation includes User
      const changeWithOwner = await prisma.changeRequest.findUnique({
        where:   { id: change.id },
        include: { createdBy: true }
      });

      assert.ok(changeWithOwner.createdBy, 'createdBy relation should be populated');
      assert.equal(changeWithOwner.createdBy.id, user.id);
      assert.equal(changeWithOwner.createdBy.email, 'bob.requester@example.com');
      assert.equal(changeWithOwner.createdBy.name, 'Bob Requester');

      // 4. Verify fetching User with changeRequestsCreated relation includes ChangeRequest
      const userWithChanges = await prisma.user.findUnique({
        where:   { id: user.id },
        include: { changeRequestsCreated: true }
      });

      assert.ok(Array.isArray(userWithChanges.changeRequestsCreated));
      assert.equal(userWithChanges.changeRequestsCreated.length, 1);
      assert.equal(userWithChanges.changeRequestsCreated[0].id, change.id);
      assert.equal(userWithChanges.changeRequestsCreated[0].title, 'Add caching layer');
    } finally {
      // Foreign-key-safe cleanup order: change requests first, users second
      if (change?.id) await cleanupChange(change.id);
      if (user?.id) await cleanupUser(user.id);
    }
  });

});
