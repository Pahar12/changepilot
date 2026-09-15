'use strict';

/**
 * tests/errorHandler.test.js
 *
 * Pure tests for app.js's global error handler.
 *
 * Neither malformed-JSON nor disallowed-CORS-origin requests ever reach a
 * route handler (body-parser and the cors() middleware both reject them
 * before routing), so these tests need no database fixtures at all — only
 * the Express app bound to a random port.
 *
 * These tests specifically cover the "no stack trace / no file paths for
 * expected client errors" hardening: they mock console.error/console.warn
 * to assert not just the HTTP response, but *what gets logged server-side*.
 */

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('dotenv').config();

const app = require('../app');
const prisma = require('../src/lib/prisma');

let server;

before(async () => {
  // Merely requiring app.js pulls in the Prisma singleton, which lazily
  // starts loading its query engine as a side effect of the first
  // require/construction — independent of whether any test issues a query.
  // In this sandbox that lazy load always rejects (Linux Query Engine
  // binary unavailable — see project report), and if left untouched it
  // surfaces later as an untracked "asynchronous activity after the test
  // ended" failure rather than a real assertion failure. Triggering and
  // swallowing it once, deterministically, inside this tracked hook keeps
  // that pre-existing sandbox/platform limitation from being misreported
  // as a failure in these DB-free error-handler tests.
  await prisma.$connect().catch(() => {});

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

/**
 * POST a raw string body with an application/json Content-Type, bypassing
 * JSON.stringify so we can send deliberately malformed JSON.
 */
function postRaw(path, rawBody, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        ...extraHeaders
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

describe('global error handler — malformed JSON logging', () => {
  test('returns a controlled 400 JSON response with no internal detail', async () => {
    const { status, headers, body } = await postRaw('/api/v1/changes', '{this is not valid json}');

    assert.equal(status, 400);
    assert.ok((headers['content-type'] || '').includes('application/json'));
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Invalid JSON');

    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('stack'), 'response must not contain "stack"');
    assert.ok(!serialised.includes('node_modules'), 'response must not contain node_modules paths');
    assert.ok(!serialised.includes('/home/'), 'response must not contain filesystem paths');
  });

  test('logs a single controlled warning line, never the raw SyntaxError/stack', async () => {
    const errorSpy = mock.method(console, 'error', () => {});
    const warnSpy = mock.method(console, 'warn', () => {});

    try {
      await postRaw('/api/v1/changes', '{this is not valid json}');

      // The raw body-parser SyntaxError (with its stack/file paths) must
      // never reach console.error for this expected, operational error.
      assert.equal(errorSpy.mock.callCount(), 0, 'console.error must not be called for malformed JSON');

      // A controlled, minimal line should be logged instead.
      assert.equal(warnSpy.mock.callCount(), 1);
      const [line] = warnSpy.mock.calls[0].arguments;
      assert.ok(line.includes('malformed JSON'));
      assert.ok(!line.includes('node_modules'));
      assert.ok(!line.includes('    at ')); // stack trace frame marker
    } finally {
      errorSpy.mock.restore();
      warnSpy.mock.restore();
    }
  });
});

describe('global error handler — disallowed CORS origin', () => {
  test('a disallowed Origin gets a controlled 403, not a 500 with a stack trace', async () => {
    const errorSpy = mock.method(console, 'error', () => {});
    const warnSpy = mock.method(console, 'warn', () => {});

    try {
      const { status, body } = await postRaw('/api/v1/changes', '{}', {
        Origin: 'https://evil.example.com'
      });

      assert.equal(status, 403);
      assert.equal(body.status, 'fail');
      assert.equal(body.message, 'Not allowed by CORS');

      assert.equal(errorSpy.mock.callCount(), 0, 'console.error must not be called for a disallowed origin');
      assert.equal(warnSpy.mock.callCount(), 1);
      assert.ok(warnSpy.mock.calls[0].arguments[0].includes('disallowed origin'));
    } finally {
      errorSpy.mock.restore();
      warnSpy.mock.restore();
    }
  });

  test('an allowed Origin is not blocked by CORS', async () => {
    // Note: this only proves the request gets past the CORS layer — it will
    // still fail downstream (401, no auth) which is expected and irrelevant here.
    const { status } = await postRaw('/api/v1/changes', '{}', {
      Origin: 'http://localhost:3000'
    });
    assert.notEqual(status, 403);
  });
});

describe('global error handler — genuinely unexpected errors are still logged', () => {
  test('a 404 for an unknown route does not touch the error handler at all', async () => {
    const errorSpy = mock.method(console, 'error', () => {});
    const warnSpy = mock.method(console, 'warn', () => {});

    try {
      const { status, body } = await postRaw('/api/v1/does-not-exist', '{}');
      assert.equal(status, 404);
      assert.equal(body.status, 'fail');
      assert.equal(errorSpy.mock.callCount(), 0);
      assert.equal(warnSpy.mock.callCount(), 0);
    } finally {
      errorSpy.mock.restore();
      warnSpy.mock.restore();
    }
  });
});
