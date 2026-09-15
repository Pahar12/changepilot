'use strict';

/**
 * tests/auditService.test.js
 *
 * Pure unit tests for src/services/auditService.js.
 *
 * recordAuditEvent() accepts an injectable Prisma-like `client` parameter,
 * so these tests use a fake in-memory client instead of a real database —
 * they exercise the metadata secret-guard (assertSafeMetadata) and the
 * exact shape of the row handed to `client.auditEvent.create()`, without
 * needing Postgres or a Prisma Query Engine at all.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { recordAuditEvent } = require('../src/services/auditService');

function fakeClient() {
  const calls = [];
  return {
    calls,
    auditEvent: {
      async create({ data }) {
        calls.push(data);
        return { id: 'fake-audit-id', ...data, createdAt: new Date() };
      }
    }
  };
}

describe('recordAuditEvent — happy path', () => {
  test('writes exactly the expected shape to client.auditEvent.create', async () => {
    const client = fakeClient();
    await recordAuditEvent(
      {
        actorId: 'user-1',
        action: 'CHANGE_CREATED',
        entityType: 'ChangeRequest',
        entityId: 'change-1',
        changeRequestId: 'change-1',
        metadata: { title: 'Update homepage', riskLevel: 'LOW' }
      },
      client
    );

    assert.equal(client.calls.length, 1);
    assert.deepEqual(client.calls[0], {
      actorId: 'user-1',
      action: 'CHANGE_CREATED',
      entityType: 'ChangeRequest',
      entityId: 'change-1',
      changeRequestId: 'change-1',
      metadata: { title: 'Update homepage', riskLevel: 'LOW' }
    });
  });

  test('metadata is optional', async () => {
    const client = fakeClient();
    await recordAuditEvent(
      { actorId: 'user-1', action: 'X', entityType: 'Y', entityId: 'z' },
      client
    );
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].metadata, undefined);
  });

  test('changeRequestId is optional (e.g. for events with no associated ChangeRequest)', async () => {
    const client = fakeClient();
    await recordAuditEvent(
      { actorId: 'user-1', action: 'X', entityType: 'Y', entityId: 'z', metadata: { ok: true } },
      client
    );
    assert.equal(client.calls[0].changeRequestId, undefined);
  });

  test('defaults to the shared prisma singleton when no client is passed (does not throw synchronously)', () => {
    // We don't await this — it will eventually fail against a real DB
    // connection in environments without Postgres, but constructing the
    // call and passing the metadata guard must not throw synchronously.
    assert.doesNotThrow(() => {
      recordAuditEvent({ actorId: 'a', action: 'B', entityType: 'C', entityId: 'd' }).catch(() => {});
    });
  });
});

describe('recordAuditEvent — secret-key guard (assertSafeMetadata)', () => {
  const forbiddenKeys = ['password', 'jwt', 'secret', 'apiKey', 'api_key', 'token', 'authorization', 'credential'];

  for (const key of forbiddenKeys) {
    test(`rejects top-level metadata key "${key}" before ever calling the database`, async () => {
      const client = fakeClient();
      await assert.rejects(() =>
        recordAuditEvent(
          { actorId: 'u', action: 'A', entityType: 'T', entityId: 'i', metadata: { [key]: 'super-secret-value' } },
          client
        )
      );
      assert.equal(client.calls.length, 0, 'the database must never be called when metadata is unsafe');
    });
  }

  test('rejects a forbidden key nested inside metadata', async () => {
    const client = fakeClient();
    await assert.rejects(() =>
      recordAuditEvent(
        {
          actorId: 'u',
          action: 'A',
          entityType: 'T',
          entityId: 'i',
          metadata: { context: { nested: { password: 'hunter2' } } }
        },
        client
      )
    );
    assert.equal(client.calls.length, 0);
  });

  test('is case-insensitive', async () => {
    const client = fakeClient();
    await assert.rejects(() =>
      recordAuditEvent(
        { actorId: 'u', action: 'A', entityType: 'T', entityId: 'i', metadata: { ApiKey: 'x' } },
        client
      )
    );
    assert.equal(client.calls.length, 0);
  });

  test('safe metadata resembling real usage passes through', async () => {
    const client = fakeClient();
    await recordAuditEvent(
      {
        actorId: 'u',
        action: 'A',
        entityType: 'T',
        entityId: 'i',
        metadata: { riskLevel: 'HIGH', recommendation: 'APPROVE', changedFields: ['title'] }
      },
      client
    );
    assert.equal(client.calls.length, 1);
  });

  test('arrays and primitive metadata values are not treated as objects to scan (no crash)', async () => {
    const client = fakeClient();
    await recordAuditEvent(
      { actorId: 'u', action: 'A', entityType: 'T', entityId: 'i', metadata: { tags: ['a', 'b'], count: 3, note: 'fine' } },
      client
    );
    assert.equal(client.calls.length, 1);
  });
});
