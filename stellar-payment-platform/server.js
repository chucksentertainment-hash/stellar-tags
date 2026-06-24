const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const { Prisma } = require('@prisma/client');
const { prisma } = require('./prismaClient');
const { scheduleCleanupJob } = require('./src/cleanup-cron');

const app = express();
const PORT = process.env.PORT || 5000;
// Ensure to add the value for STELLAR_TAG_DOMAIN in the env file
const STELLAR_TAG_DOMAIN = process.env.STELLAR_TAG_DOMAIN;

const allowedOrigins = [
  'http://localhost:5173',
  'https://stellar-tags.vercel.app',
  STELLAR_TAG_DOMAIN,
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// #49 — Enforce strict 10kb JSON payload size limit to prevent DoS via oversized payloads
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// Reject nested objects/arrays in query and body params (NoSQL-style injection
// hardening — every accepted parameter must be a primitive value).
// ---------------------------------------------------------------------------
const isPrimitive = (v) => v === null || v === undefined || typeof v !== 'object';

const rejectNestedObjects = (req, res, next) => {
  const sources = [req.query, req.body];
  for (const source of sources) {
    if (source && typeof source === 'object') {
      for (const val of Object.values(source)) {
        if (!isPrimitive(val)) {
          return res
            .status(400)
            .json({ detail: 'Invalid parameter type: nested objects and arrays are not allowed.' });
        }
      }
    }
  }
  next();
};

app.use(rejectNestedObjects);

// ---------------------------------------------------------------------------
// Database — PostgreSQL via Prisma ORM
// ---------------------------------------------------------------------------
// The legacy raw sqlite3 layer (manual generic-pool, hand-written SQL and
// schema bootstrap) has been replaced by the Prisma Client. Prisma owns its
// own connection pool, configurable through the DATABASE_URL query string
// (e.g. ?connection_limit=10&pool_timeout=5). The schema lives in
// prisma/schema.prisma and is applied with `npm run prisma:migrate`.

// Start the weekly background job that prunes/flags stale registrations.
scheduleCleanupJob(prisma);

const USER_DATABASE = {
  'client*localhost': 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ',
  'lekan*localhost': 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ',
};

const DEFAULT_FEDERATION_DOMAIN = 'localhost';

const normalizeNameTag = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '';
  }
  return trimmed.includes('*') ? trimmed : `${trimmed}*${DEFAULT_FEDERATION_DOMAIN}`;
};

// ---------------------------------------------------------------------------
// #51 — ETag Caching Middleware for Federation Endpoint
// ---------------------------------------------------------------------------
// Generates a SHA-256 based ETag from the JSON response body.
// If the client sends a matching If-None-Match header, the server responds
// with 304 Not Modified without re-running the database query on subsequent
// requests (Express caches the comparison after the first response).
const etagCache = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const bodyString = JSON.stringify(body);
    const hash = crypto.createHash('sha256').update(bodyString).digest('hex');
    const etag = `"${hash}"`;

    res.set('ETag', etag);

    // Check If-None-Match header — return 304 if content hasn't changed
    const clientEtag = req.get('If-None-Match');
    if (clientEtag && clientEtag === etag) {
      return res.status(304).end();
    }

    return originalJson(body);
  };

  next();
};

app.get('/federation', etagCache, async (req, res, next) => {
  const nameTag = normalizeNameTag(req.query.q);

  if (!nameTag) {
    const error = new Error("Missing 'q' parameter");
    error.statusCode = 400;
    return next(error);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username: nameTag },
    });

    const address = user?.address || USER_DATABASE[nameTag];
    if (!address) {
      const notFoundError = new Error('Name tag not found');
      notFoundError.statusCode = 404;
      return next(notFoundError);
    }

    return res.json({
      stellar_address: address,
      account_id: address,
      memo_type: 'text',
      memo: 'PlatformPayment',
    });
  } catch {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.post('/register', async (req, res, next) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

  if (!username || !address) {
    return res.status(400).json({ error: 'Missing required fields: username and address are both required.' });
  }

  // Lazily required so loading this module (e.g. in unit tests) does not pull
  // in the Stellar SDK and its ESM dependencies. Node caches the require.
  const { StrKey } = require('@stellar/stellar-sdk');

  if (!StrKey.isValidEd25519PublicKey(address)) {
    const error = new Error('Invalid Stellar Public Key format.');
    error.statusCode = 400;
    return next(error);
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { address },
    });

    if (existing) {
      const conflictError = new Error('Address already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }

    await prisma.user.create({
      data: { username, address },
    });

    return res.json({ ok: true, username, address });
  } catch (error) {
    // P2002 — unique constraint violation (username or address already taken)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const isAddress = Array.isArray(target)
        ? target.includes('address')
        : typeof target === 'string' && target.includes('address');
      const conflictError = new Error(isAddress ? 'Address already registered' : 'Username already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }

    const registrationError = new Error('Failed to save registration');
    registrationError.statusCode = 500;
    return next(registrationError);
  }
});

app.get('/lookup', async (req, res, next) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';

  if (!address) {
    const error = new Error("Missing 'address' parameter");
    error.statusCode = 400;
    return next(error);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { address },
    });

    if (!user) {
      const notFoundError = new Error('Username not found for this address');
      notFoundError.statusCode = 404;
      return next(notFoundError);
    }

    return res.json({ username: user.username, address });
  } catch {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.get('/users', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const search = typeof req.query.search === 'string' ? req.query.search : null;
  const skip = (page - 1) * limit;

  const where = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  try {
    const [totalCount, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const data = users.map((user) => ({
      username: user.username,
      address: user.address,
      created_at: user.createdAt.toISOString(),
    }));

    return res.json({ data, totalCount, totalPages, currentPage: page });
  } catch {
    const dbError = new Error('Database error');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// #49 — Payload size limit violations are normalised into the global handler.
app.use((err, _req, _res, next) => {
  if (err.type === 'entity.too.large') {
    const error = new Error('Payload too large. Maximum allowed size is 10kb.');
    error.statusCode = 413;
    return next(error);
  }
  next(err);
});

// Global error handling middleware
app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal server error';

  if (statusCode === 500) {
    const errorId = crypto.randomUUID();
    console.error(`[Error ID: ${errorId}]`, err);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      reference_id: errorId,
    });
  }

  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    statusCode,
  });
});

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10_000;

let isShuttingDown = false;

// Pool-agnostic graceful shutdown. The `pool` argument exposes async
// drain()/clear() hooks; in production a thin adapter around the Prisma client
// is supplied (see below) so the database connections are closed cleanly.
const gracefulShutdown = (server, pool, signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  const timer = setTimeout(() => {
    console.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  server.close(async () => {
    clearTimeout(timer);
    try {
      await pool.drain();
      await pool.clear();
    } catch (err) {
      console.error('Error draining DB pool during shutdown:', err);
    }
    process.exit(0);
  });
};

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully initialized on port ${PORT}`);
  });

  // This catches any weird cloud port errors and prevents a hard crash
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is in use, forcing shutdown so Railway can restart cleanly.`);
      process.exit(1);
    }
  });

  // Adapt the Prisma client to the drain()/clear() contract gracefulShutdown
  // expects: there is no separate pool to drain, so disconnect on clear().
  const prismaPool = {
    drain: () => Promise.resolve(),
    clear: () => prisma.$disconnect(),
  };

  process.on('SIGTERM', (sig) => gracefulShutdown(server, prismaPool, sig));
  process.on('SIGINT', (sig) => gracefulShutdown(server, prismaPool, sig));
}

// Export for testing and for the Horizon listener
module.exports = { app, prisma, gracefulShutdown, rejectNestedObjects };
