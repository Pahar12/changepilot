'use strict';

/**
 * src/lib/prisma.js — shared PrismaClient singleton.
 *
 * Instantiated once at module load; Node's require cache ensures every
 * subsequent require() of this file gets the same instance.
 *
 * A single instance means a single connection pool, which is correct for
 * both the application and the test suite.  The test teardown calls
 * prisma.$disconnect() exactly once through this shared reference.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
