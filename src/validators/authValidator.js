'use strict';

/**
 * src/validators/authValidator.js — pure input validation for authentication endpoints.
 *
 * Returns { errors: Array<{field: string, message: string}>, data: Object|null }.
 * Pure functions: no Express, no Prisma, no side effects.
 */

// Email regex pattern (RFC 5322 subset)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Allowed fields for registration.
// NOTE: 'role' is explicitly NOT permitted on public registration to prevent privilege escalation.
const ALLOWED_REGISTER_FIELDS = ['name', 'email', 'password'];

// Allowed fields for login.
const ALLOWED_LOGIN_FIELDS = ['email', 'password'];

/**
 * Validate body for POST /api/v1/auth/register.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateRegister(body) {
  const errors = [];
  const raw = body || {};

  // ── Unknown / forbidden fields ──────────────────────────────────────────────
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_REGISTER_FIELDS.includes(key)) {
      errors.push({ field: key, message: `Field "${key}" is not permitted` });
    }
  }

  // ── name ────────────────────────────────────────────────────────────────────
  let name;
  if (raw.name === undefined || raw.name === null) {
    errors.push({ field: 'name', message: 'name is required' });
  } else if (typeof raw.name !== 'string') {
    errors.push({ field: 'name', message: 'name must be a string' });
  } else {
    name = raw.name.trim();
    if (name.length === 0) {
      errors.push({ field: 'name', message: 'name must not be empty' });
      name = undefined;
    } else if (name.length > 100) {
      errors.push({ field: 'name', message: 'name must not exceed 100 characters' });
      name = undefined;
    }
  }

  // ── email ───────────────────────────────────────────────────────────────────
  let email;
  if (raw.email === undefined || raw.email === null) {
    errors.push({ field: 'email', message: 'email is required' });
  } else if (typeof raw.email !== 'string') {
    errors.push({ field: 'email', message: 'email must be a string' });
  } else {
    email = raw.email.trim().toLowerCase();
    if (email.length === 0) {
      errors.push({ field: 'email', message: 'email must not be empty' });
      email = undefined;
    } else if (!EMAIL_RE.test(email)) {
      errors.push({ field: 'email', message: 'email must be a valid email address' });
      email = undefined;
    }
  }

  // ── password ────────────────────────────────────────────────────────────────
  let password;
  if (raw.password === undefined || raw.password === null) {
    errors.push({ field: 'password', message: 'password is required' });
  } else if (typeof raw.password !== 'string') {
    errors.push({ field: 'password', message: 'password must be a string' });
  } else {
    if (raw.password.length < 8) {
      errors.push({ field: 'password', message: 'password must be at least 8 characters long' });
    } else if (raw.password.length > 128) {
      errors.push({ field: 'password', message: 'password must not exceed 128 characters' });
    } else {
      password = raw.password;
    }
  }

  if (errors.length > 0) {
    return { errors, data: null };
  }

  return {
    errors: [],
    data: {
      name,
      email,
      password
    }
  };
}

/**
 * Validate body for POST /api/v1/auth/login.
 *
 * @param {Object} body - raw req.body
 * @returns {{ errors: Array<{field:string, message:string}>, data: Object|null }}
 */
function validateLogin(body) {
  const errors = [];
  const raw = body || {};

  // ── Unknown / forbidden fields ──────────────────────────────────────────────
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_LOGIN_FIELDS.includes(key)) {
      errors.push({ field: key, message: `Field "${key}" is not permitted` });
    }
  }

  // ── email ───────────────────────────────────────────────────────────────────
  let email;
  if (raw.email === undefined || raw.email === null) {
    errors.push({ field: 'email', message: 'email is required' });
  } else if (typeof raw.email !== 'string') {
    errors.push({ field: 'email', message: 'email must be a string' });
  } else {
    email = raw.email.trim().toLowerCase();
    if (email.length === 0) {
      errors.push({ field: 'email', message: 'email must not be empty' });
      email = undefined;
    }
  }

  // ── password ────────────────────────────────────────────────────────────────
  let password;
  if (raw.password === undefined || raw.password === null) {
    errors.push({ field: 'password', message: 'password is required' });
  } else if (typeof raw.password !== 'string') {
    errors.push({ field: 'password', message: 'password must be a string' });
  } else if (raw.password.length === 0) {
    errors.push({ field: 'password', message: 'password must not be empty' });
  } else {
    password = raw.password;
  }

  if (errors.length > 0) {
    return { errors, data: null };
  }

  return {
    errors: [],
    data: {
      email,
      password
    }
  };
}

module.exports = {
  validateRegister,
  validateLogin
};
