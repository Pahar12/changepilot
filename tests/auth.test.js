'use strict';

/**
 * tests/auth.test.js
 *
 * Integration tests for authentication endpoints:
 *   - POST /api/v1/auth/register
 *   - POST /api/v1/auth/login
 *   - GET  /api/v1/auth/me
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('dotenv').config();

const app = require('../app');
const prisma = require('../src/lib/prisma');
const { signToken } = require('../src/lib/jwt');
const env = require('../src/config/env');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function post(server, path, payload, headers = {}) {
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
        ...headers
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

function get(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port:     addr.port,
      path,
      method:   'GET',
      headers
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
    req.end();
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server;

before(async () => {
  await prisma.changeRequest.deleteMany({});
  await prisma.user.deleteMany({});

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

// ── Cleanup helper ────────────────────────────────────────────────────────────

async function cleanupUser(id) {
  if (!id) return;
  await prisma.user.delete({ where: { id } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {

  test('successfully registers a user with default REQUESTER role and returns token', async () => {
    const email = 'reg.success@example.com';
    const { status, body } = await post(server, '/api/v1/auth/register', {
      name:     'Jane Requester',
      email,
      password: 'StrongPassword123'
    });

    assert.equal(status, 201);
    assert.equal(body.status, 'success');
    assert.ok(body.data.token, 'token should be present');
    assert.ok(body.data.user.id, 'user.id should be present');
    assert.equal(body.data.user.name, 'Jane Requester');
    assert.equal(body.data.user.email, email);
    assert.equal(body.data.user.role, 'REQUESTER');
    assert.equal(body.data.user.passwordHash, undefined, 'passwordHash must never be exposed');

    // Verify database record has scrypt passwordHash
    const dbUser = await prisma.user.findUnique({ where: { email } });
    try {
      assert.ok(dbUser);
      assert.ok(dbUser.passwordHash.includes(':'), 'passwordHash should be formatted salt:hash');
      assert.notEqual(dbUser.passwordHash, 'StrongPassword123', 'plaintext password must never be stored');
    } finally {
      await cleanupUser(dbUser?.id);
    }
  });

  test('rejects privilege escalation attempt (passing role in registration body)', async () => {
    const { status, body } = await post(server, '/api/v1/auth/register', {
      name:     'Privilege Escalator',
      email:    'hacker@example.com',
      password: 'Password123!',
      role:     'ADMIN'
    });

    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(body.errors.some((e) => e.field === 'role'));
  });

  test('returns 409 when registering with an existing email', async () => {
    const email = 'duplicate.reg@example.com';
    const first = await post(server, '/api/v1/auth/register', {
      name:     'First User',
      email,
      password: 'Password123!'
    });
    assert.equal(first.status, 201);

    try {
      const second = await post(server, '/api/v1/auth/register', {
        name:     'Second User',
        email,
        password: 'Password123!'
      });

      assert.equal(second.status, 409);
      assert.equal(second.body.status, 'fail');
      assert.equal(second.body.message, 'Email is already registered');
    } finally {
      await cleanupUser(first.body.data.user.id);
    }
  });

  test('returns 400 on missing name, email, or password', async () => {
    const { status, body } = await post(server, '/api/v1/auth/register', {});
    assert.equal(status, 400);
    assert.equal(body.status, 'fail');
    assert.ok(body.errors.some((e) => e.field === 'name'));
    assert.ok(body.errors.some((e) => e.field === 'email'));
    assert.ok(body.errors.some((e) => e.field === 'password'));
  });

  test('returns 400 when password is under 8 characters', async () => {
    const { status, body } = await post(server, '/api/v1/auth/register', {
      name:     'Short Pass',
      email:    'short@example.com',
      password: 'short'
    });
    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'password'));
  });

  test('returns 400 when email format is invalid', async () => {
    const { status, body } = await post(server, '/api/v1/auth/register', {
      name:     'Bad Email',
      email:    'not-an-email',
      password: 'ValidPassword123'
    });
    assert.equal(status, 400);
    assert.ok(body.errors.some((e) => e.field === 'email'));
  });

});

describe('POST /api/v1/auth/login', () => {

  test('successfully logs in with valid credentials and returns token', async () => {
    const email = 'login.success@example.com';
    const reg = await post(server, '/api/v1/auth/register', {
      name:     'Login User',
      email,
      password: 'MyPassword123'
    });
    assert.equal(reg.status, 201);

    try {
      const { status, body } = await post(server, '/api/v1/auth/login', {
        email,
        password: 'MyPassword123'
      });

      assert.equal(status, 200);
      assert.equal(body.status, 'success');
      assert.ok(body.data.token);
      assert.equal(body.data.user.email, email);
      assert.equal(body.data.user.passwordHash, undefined, 'passwordHash must not be exposed');
    } finally {
      await cleanupUser(reg.body.data.user.id);
    }
  });

  test('returns 401 with generic error message on incorrect password', async () => {
    const email = 'wrong.pass@example.com';
    const reg = await post(server, '/api/v1/auth/register', {
      name:     'Wrong Pass User',
      email,
      password: 'CorrectPassword123'
    });
    assert.equal(reg.status, 201);

    try {
      const { status, body } = await post(server, '/api/v1/auth/login', {
        email,
        password: 'IncorrectPassword'
      });

      assert.equal(status, 401);
      assert.equal(body.status, 'fail');
      assert.equal(body.message, 'Invalid email or password');
    } finally {
      await cleanupUser(reg.body.data.user.id);
    }
  });

  test('returns 401 with generic error message on nonexistent email', async () => {
    const { status, body } = await post(server, '/api/v1/auth/login', {
      email:    'nonexistent@example.com',
      password: 'AnyPassword123'
    });

    assert.equal(status, 401);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Invalid email or password');
  });

});

describe('GET /api/v1/auth/me', () => {

  test('returns 200 with current user profile for valid Bearer token', async () => {
    const email = 'me.test@example.com';
    const reg = await post(server, '/api/v1/auth/register', {
      name:     'Me Tester',
      email,
      password: 'Password123!'
    });
    assert.equal(reg.status, 201);
    const token = reg.body.data.token;

    try {
      const { status, body } = await get(server, '/api/v1/auth/me', {
        Authorization: `Bearer ${token}`
      });

      assert.equal(status, 200);
      assert.equal(body.status, 'success');
      assert.equal(body.data.user.email, email);
      assert.equal(body.data.user.name, 'Me Tester');
      assert.equal(body.data.user.role, 'REQUESTER');
      assert.equal(body.data.user.passwordHash, undefined);
    } finally {
      await cleanupUser(reg.body.data.user.id);
    }
  });

  test('returns 401 when Authorization header is missing', async () => {
    const { status, body } = await get(server, '/api/v1/auth/me');
    assert.equal(status, 401);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Authentication required');
  });

  test('returns 401 when Authorization header does not use Bearer scheme', async () => {
    const { status, body } = await get(server, '/api/v1/auth/me', {
      Authorization: 'Basic dXNlcjpwYXNz'
    });
    assert.equal(status, 401);
    assert.equal(body.status, 'fail');
  });

  test('returns 401 when Bearer token is invalid/tampered', async () => {
    const { status, body } = await get(server, '/api/v1/auth/me', {
      Authorization: 'Bearer invalid.token.signature'
    });
    assert.equal(status, 401);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Invalid or expired token');
  });

  test('returns 401 when Bearer token has expired', async () => {
    const expiredToken = signToken(
      { userId: 'fake-id', email: 'exp@example.com', role: 'REQUESTER' },
      env.jwtSecret,
      -3600 // Expired 1 hour ago
    );

    const { status, body } = await get(server, '/api/v1/auth/me', {
      Authorization: `Bearer ${expiredToken}`
    });

    assert.equal(status, 401);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Invalid or expired token');
  });

  test('returns 401 when JWT header uses an unsupported algorithm', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      userId: 'fake-id',
      email: 'alg@example.com',
      role: 'REQUESTER',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const token = `${header}.${payload}.bogussignature`;

    const { status, body } = await get(server, '/api/v1/auth/me', {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 401);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Invalid or expired token');
  });

});
