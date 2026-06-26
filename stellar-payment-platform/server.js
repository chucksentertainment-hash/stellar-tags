const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const { Horizon, StrKey } = require('@stellar/stellar-sdk');
const PDFDocument = require('pdfkit');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prismaClient');
const { scheduleCleanupJob } = require('./src/cleanup-cron');

const HORIZON_BASE = 'https://horizon-testnet.stellar.org';
const TX_HASH_RE = /^[a-fA-F0-9]{64}$/;

const app = express();
app.set('query parser', 'simple');
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
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});

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

// ---------------------------------------------------------------------------
// #81 — SEP-0002: Handle type=id Federation Queries
// ---------------------------------------------------------------------------
app.get('/federation', etagCache, async (req, res, next) => {
  // Extract q (query) and type parameters from the request
  const { q, type } = req.query;
  const queryValue = typeof q === 'string' ? q.trim() : '';

  // Validate that q parameter exists
  if (!queryValue) {
    const error = new Error("Missing 'q' parameter");
    error.statusCode = 400;
    return next(error);
  }

  try {
    // Branch logic based on type parameter (SEP-0002 compliance)
    if (type === 'id') {
      // Reverse lookup: search by Stellar address (case-insensitive)
      const row = await prisma.user.findFirst({
        where: { address: { equals: queryValue, mode: 'insensitive' } },
        select: { username: true, address: true },
      });

      if (!row) {
        const notFoundError = new Error('Address not found');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      // Return federation response for address lookup
      return res.json({
        stellar_address: `${row.username}*${process.env.DOMAIN || 'localhost'}`,
        account_id: row.address,
        memo_type: 'text',
        memo: 'PlatformPayment',
      });
    } else if (type === 'name' || !type) {
      // Default: lookup by username (backward compatible)
      // Normalize the name tag (e.g., "alice*localhost") and lowercase it.
      const nameTag = normalizeNameTag(queryValue);
      const queryName = nameTag.toLowerCase();

      const row = await prisma.user.findUnique({
        where: { username: queryName },
        select: { address: true },
      });

      // Fallback to hardcoded USER_DATABASE for backward compatibility
      const address = row?.address || USER_DATABASE[queryName];

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
    } else {
      // Unsupported type parameter
      return res.status(400).json({
        error: "Unsupported query type. Supported types: 'id', 'name'",
      });
    }
  } catch {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.post('/register', async (req, res, next) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

  if (address.toUpperCase().startsWith('S')) {
    return res.status(400).json({ error: "Never share your Secret Key. Please register using your Public Key (starts with G)." });
  }

  if (!username || !address) {
    return res.status(400).json({ error: 'Missing required fields: username and address are both required.' });
  }

  const usernameLocalPart = username.includes('*') ? username.split('*')[0] : username;
  if (usernameLocalPart.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters long." });
  }

  if (!StrKey.isValidEd25519PublicKey(address)) {
    const error = new Error('Invalid Stellar Public Key format.');
    error.statusCode = 400;
    return next(error);
  }

  // Convert to lowercase for case-insensitive storage
  const normalizedUsername = username.toLowerCase();

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
      data: { username: normalizedUsername, address },
    });

    return res.status(201).json({
      ok: true,
      username: normalizedUsername,
      address,
      federation_address: `${normalizedUsername}*${process.env.DOMAIN || 'localhost'}`,
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE'))) {
      return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
    }
    const registrationError = new Error('Failed to save registration');
    registrationError.statusCode = 500;
    return next(registrationError);
  }
});

app.get('/lookup', async (req, res, next) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  if (!address && !search) {
    const error = new Error("Missing required parameter: provide 'address' for exact lookup or 'search' for paginated search");
    error.statusCode = 400;
    return next(error);
  }

  // Exact lookup by address — original behaviour, returns a single record
  if (address) {
    try {
      const row = await prisma.user.findUnique({
        where: { address },
        select: { username: true },
      });

      if (!row) {
        const notFoundError = new Error('Username not found for this address');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      return res.json({ username: row.username, address });
    } catch {
      const dbError = new Error('Database lookup failed');
      dbError.statusCode = 500;
      return next(dbError);
    }
  }

  // Paginated search by partial username or address
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const skip = (page - 1) * limit;

  const where = {
    OR: [
      { username: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ],
  };

  try {
    const [totalCount, rows] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const data = rows.map((user) => ({
      username: user.username,
      address: user.address,
      created_at: user.createdAt.toISOString(),
    }));

    return res.json({ data, totalCount, totalPages, currentPage: page });
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
    const [totalCount, rows] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const data = rows.map((user) => ({
      username: user.username,
      address: user.address,
      created_at: user.createdAt.toISOString(),
    }));

    res.json({ data, totalCount, totalPages, currentPage: page });
  } catch {
    const dbError = new Error('Database error');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.get('/.well-known/stellar.toml', cors({ origin: '*' }), (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('FEDERATION_SERVER="https://stellar-tags-production.up.railway.app/federation"\n');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/v1/receipts/:txHash', async (req, res) => {
  const { txHash } = req.params;

  if (!TX_HASH_RE.test(txHash)) {
    return res.status(400).json({ detail: 'Invalid transaction hash format' });
  }

  let tx;
  let paymentOps;

  try {
    const server = new Horizon.Server(HORIZON_BASE);
    [tx, paymentOps] = await Promise.all([
      server.transactions().transaction(txHash).call(),
      server.payments().forTransaction(txHash).call(),
    ]);
  } catch (err) {
    if (err && err.response && err.response.status === 404) {
      return res.status(404).json({ detail: 'Transaction not found' });
    }
    return res.status(500).json({ detail: 'Failed to fetch transaction' });
  }

  const timestamp = tx.created_at
    ? new Date(tx.created_at).toUTCString()
    : 'Unknown';

  const nativeOp = (paymentOps.records || []).find(
    (op) => op.asset_type === 'native',
  );

  const sender = nativeOp ? nativeOp.from : tx.source_account;
  const receiver = nativeOp ? nativeOp.to : 'Contract invocation';
  const amount = nativeOp ? `${nativeOp.amount} XLM` : 'See Stellar Explorer';

  const safeHash = txHash.replace(/[^a-fA-F0-9]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="receipt-${safeHash}.pdf"`,
  );

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc
    .fontSize(20)
    .text('Stellar Transaction Receipt', { align: 'center' })
    .moveDown(1.5);

  doc.fontSize(11).text(`Transaction Hash: ${txHash}`).moveDown(0.5);
  doc.text(`Timestamp:        ${timestamp}`).moveDown(0.5);
  doc.text(`Sender:           ${sender}`).moveDown(0.5);
  doc.text(`Receiver:         ${receiver}`).moveDown(0.5);
  doc.text(`Amount:           ${amount}`).moveDown(1.5);

  doc.fontSize(9).fillColor('#888888').text('Generated by Stellar Pay — Testnet', {
    align: 'center',
  });

  doc.end();
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
app.use((err, req, res, next) => {
  // 1. Print the full error stack trace to the console (Viewable in Vercel Logs)
  console.error('\n❌ CRITICAL BACKEND ERROR:');
  console.error(err.stack);
  console.error('============================\n');

  // 2. Determine the status code (default to 500 Internal Server Error)
  const statusCode = err.statusCode || 500;

  // 3. Send a clean JSON response to the frontend so the request doesn't hang forever
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    // Only send the raw error details to the frontend if you are testing locally
    detail: process.env.NODE_ENV === 'development' ? err.stack : 'Check server logs for details'
  });
});
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully initialized on port ${PORT}`);
  });

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

module.exports = { app, prisma, gracefulShutdown, rejectNestedObjects };
