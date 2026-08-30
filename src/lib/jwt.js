'use strict';

/**
 * src/lib/jwt.js — Standards-compliant HS256 JWT implementation using node:crypto.
 *
 * Design:
 *   - Algorithm restricted to HS256 (HMAC-SHA256). Rejects 'none' and other algorithms.
 *   - Constant-time signature verification using crypto.timingSafeEqual.
 *   - Enforces token expiration (exp) and issued-at (iat) timestamps.
 *   - Base64URL encoding/decoding without external dependencies.
 */

const crypto = require('node:crypto');

/**
 * Encode a string or Buffer to Base64URL (RFC 4648 §5).
 *
 * @param {string|Buffer} input
 * @returns {string} Base64URL encoded string
 */
function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64url');
}

/**
 * Decode a Base64URL string to utf8 string.
 *
 * @param {string} str
 * @returns {string}
 */
function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Sign a JSON payload and produce an HS256 JWT string.
 *
 * @param {Object} payload           - Claims to include in payload
 * @param {string} secret            - HMAC secret key
 * @param {number} expiresInSeconds  - Lifetime in seconds (default 86400 = 24h)
 * @returns {string} JWT string `<header>.<payload>.<signature>`
 */
function signToken(payload, secret, expiresInSeconds = 86400) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('JWT secret is required and must be a string');
  }

  const ttl = Number(expiresInSeconds);
  if (!Number.isFinite(ttl)) {
    throw new Error('JWT expiration must be a finite number of seconds');
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + ttl
  };

  const encodedHeader    = base64UrlEncode(JSON.stringify(header));
  const encodedPayload   = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput     = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify and decode an HS256 JWT string.
 *
 * @param {string} token  - JWT string `<header>.<payload>.<signature>`
 * @param {string} secret - HMAC secret key
 * @returns {Object|null} Decoded payload object when valid, null on any failure
 */
function verifyToken(token, secret) {
  if (typeof token !== 'string' || !secret || typeof secret !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  // ── 1. Validate Header ───────────────────────────────────────────────────────
  let header;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
  } catch {
    return null;
  }

  // Explicit algorithm enforcement: ONLY allow HS256.
  if (!header || typeof header !== 'object' || header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  // ── 2. Verify Signature with constant-time comparison ────────────────────────
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();

  let actualSignature;
  try {
    actualSignature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return null;
  }

  if (expectedSignature.length !== actualSignature.length ||
      !crypto.timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  // ── 3. Parse and Validate Payload ───────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.userId !== 'string' || payload.userId.length === 0) {
    return null;
  }

  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    return null;
  }

  if (typeof payload.role !== 'string' || payload.role.length === 0) {
    return null;
  }

  if (!Number.isInteger(payload.iat) || payload.iat > now + 60) {
    return null;
  }

  // Check expiration claim
  if (!Number.isInteger(payload.exp) || payload.exp <= now) {
    return null;
  }

  return payload;
}

module.exports = {
  signToken,
  verifyToken,
  base64UrlEncode,
  base64UrlDecode
};
