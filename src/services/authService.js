'use strict';

/**
 * src/services/authService.js — business logic for user authentication.
 *
 * Responsibilities:
 *   - User registration (hashing password, enforcing unique email, creating user as REQUESTER)
 *   - User login (verifying password against hash, issuing JWT)
 *   - Fetching authenticated user details
 *   - Never returning or exposing passwordHash
 */

const prisma = require('../lib/prisma');
const env = require('../config/env');
const { hashPassword, verifyPassword } = require('../lib/crypto');
const { signToken } = require('../lib/jwt');

/**
 * Register a new user.
 *
 * Enforces:
 *   - Duplicate email rejection (409)
 *   - Password hashing with random salt
 *   - Initial role is ALWAYS REQUESTER (public registration cannot elevate role)
 *
 * @param {Object} fields
 * @param {string} fields.name
 * @param {string} fields.email
 * @param {string} fields.password
 * @returns {Promise<{ user: Object, token: string }>}
 */
async function register({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error('Email is already registered');
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: 'REQUESTER'
    }
  });

  const token = signToken(
    { userId: user.id, email: user.email, role: user.role },
    env.jwtSecret,
    env.jwtExpiresIn
  );

  return {
    user: {
      id:        user.id,
      name:      user.name,
      email:     user.email,
      role:      user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
    token
  };
}

/**
 * Authenticate a user with email and password.
 *
 * @param {Object} credentials
 * @param {string} credentials.email
 * @param {string} credentials.password
 * @returns {Promise<{ user: Object, token: string }>}
 */
async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const token = signToken(
    { userId: user.id, email: user.email, role: user.role },
    env.jwtSecret,
    env.jwtExpiresIn
  );

  return {
    user: {
      id:        user.id,
      name:      user.name,
      email:     user.email,
      role:      user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
    token
  };
}

/**
 * Retrieve user details by ID.
 *
 * @param {string} userId - UUID v4
 * @returns {Promise<Object>} sanitized user object
 */
async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  return {
    id:        user.id,
    name:      user.name,
    email:     user.email,
    role:      user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

module.exports = {
  register,
  login,
  getMe
};
