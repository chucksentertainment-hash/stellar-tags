// ---------------------------------------------------------------------------
// Shared Prisma Client
// ---------------------------------------------------------------------------
// A single PrismaClient instance is reused across the server and the Horizon
// listener. Prisma manages its own connection pool internally, so there is no
// need for the manual generic-pool wiring the SQLite implementation required.
//
// The pool size and timeout can be tuned via the DATABASE_URL query string,
// e.g. ?connection_limit=10&pool_timeout=5
// ---------------------------------------------------------------------------

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = { prisma };
