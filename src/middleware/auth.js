'use strict';

/**
 * src/middleware/auth.js — Authentication and Role-Based Access Control (RBAC) middleware.
 *
 * Responsibilities:
 *   - authenticate: verifies Bearer JWT in Authorization header and attaches sanitized user to req.user.
 *   - authorize(roles): enforces that req.user.role is within the allowed roles array.
 */

const env = require('../config/env');
const prisma = require('../lib/prisma');
const { verifyToken } = require('../lib/jwt');

/**
 * Authenticate incoming requests using Bearer JWT.
 *
 * Responds 401 when:
 *   - Authorization header is missing or does not start with "Bearer "
 *   - Token is empty, malformed, invalid signature, or expired
 *   - User referenced by token no longer exists in the database
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({
      status:  'fail',
      message: 'Authentication required'
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1].trim().length === 0) {
    return res.status(401).json({
      status:  'fail',
      message: 'Authentication required'
    });
  }

  const token = parts[1].trim();

  const payload = verifyToken(token, env.jwtSecret);
  if (!payload || !payload.userId) {
    return res.status(401).json({
      status:  'fail',
      message: 'Invalid or expired token'
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return res.status(401).json({
        status:  'fail',
        message: 'Invalid or expired token'
      });
    }

    // Attach sanitized user details to request (never attach passwordHash)
    req.user = {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role:  user.role
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Role-Based Access Control (RBAC) authorization middleware factory.
 *
 * @param {string[]} allowedRoles - Array of permitted UserRole strings (e.g. ['REQUESTER', 'ADMIN'])
 * @returns {Function} Express middleware
 */
function authorize(allowedRoles = []) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        status:  'fail',
        message: 'Authentication required'
      });
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status:  'fail',
        message: 'Forbidden: insufficient permissions'
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  authorize
};
