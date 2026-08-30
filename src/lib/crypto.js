'use strict';

/**
 * src/lib/crypto.js — secure password hashing and verification using node:crypto scrypt.
 *
 * Design:
 *   - 16-byte cryptographically secure random salt per password
 *   - 64-byte derived key length
 *   - Constant-time comparison using crypto.timingSafeEqual to prevent timing attacks
 *   - Format: `<saltHex>:<derivedKeyHex>`
 */

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

const SALT_BYTES = 16;
const KEY_BYTES  = 64;

/**
 * Hash a plaintext password.
 *
 * @param {string} password - plaintext password
 * @returns {Promise<string>} formatted string `${saltHex}:${derivedKeyHex}`
 */
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_BYTES);

  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored hash string.
 *
 * @param {string} password   - plaintext password to check
 * @param {string} storedHash - formatted string `${saltHex}:${derivedKeyHex}`
 * @returns {Promise<boolean>} true if matching, false otherwise
 */
async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }

  const [salt, expectedKeyHex] = parts;
  if (!salt || !expectedKeyHex) {
    return false;
  }

  try {
    const expectedKey = Buffer.from(expectedKeyHex, 'hex');
    if (expectedKey.length !== KEY_BYTES) {
      return false;
    }

    const actualKey = await scryptAsync(password, salt, KEY_BYTES);

    return crypto.timingSafeEqual(expectedKey, actualKey);
  } catch {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword
};
