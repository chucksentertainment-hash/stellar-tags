require('./config/envCheck');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { createClient } = require('redis');
const xss = require('xss');
const { Horizon, StrKey } = require('@stellar/stellar-sdk');
const PDFDocument = require('pdfkit');
const { prisma } = require('./prismaClient');
const { verifyMultiSignerThreshold } = require('./src/multisigner-verifier');
const { scheduleCleanupJob } = require('./src/cleanup-cron');
const timeout = require('connect-timeout');

require('dotenv').config();

const HORIZON_BASE = 'https://horizon-testnet.stellar.org';
const TX_HASH_RE = /^[a-fA-F0-9]{64}$/;


const app = express();

app.use(timeout('10s'));
app.use((err, req, res, next) => {
  if (req.timedout) {
    return res.status(503).json({ error: 'Service Unavailable' });
  }
  next(err);
});

app.set('query parser', 'simple');
const PORT = process.env.PORT || 5000;
const STELLAR_TAG_DOMAIN = process.env.STELLAR_TAG_DOMAIN;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'https://horizon-testnet.stellar.org', 'https://horizon.stellar.org'],
    },
  },
}));

const allowedOrigins = [
  'http://localhost:5173',
  'https://stellar-tags.vercel.app',
  STELLAR_TAG_DOMAIN
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
  optionsSuccessStatus: 204
};

const redisClient = process.env.REDIS_URL ? createClient({
  url: process.env.REDIS_URL
}) : null;
if (redisClient) {
  redisClient.connect().catch(console.error);
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  store: redisClient ? new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }) : undefined,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(cors(corsOptions));
app.use(express.json());

app.use(limiter);
app.use(express.json({ limit: '10kb' }));
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }
  next(err);
});

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

const etagCache = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const bodyString = JSON.stringify(body);
    const hash = crypto.createHash('sha256').update(bodyString).digest('hex');
    const etag = `"${hash}"`;

    res.set('ETag', etag);

    const clientEtag = req.get('If-None-Match');
    if (clientEtag && clientEtag === etag) {
      return res.status(304).end();
    }

    return originalJson(body);
  };

  next();
};

app.get('/federation', etagCache, async (req, res, next) => {
  const { q, type } = req.query;
  const queryValue = typeof q === 'string' ? q.trim() : '';

  if (!queryValue) {
    const error = new Error("Missing 'q' parameter");
    error.statusCode = 400;
    return next(error);
  }

  try {
    if (type === 'id') {
      const row = await prisma.user.findFirst({
        where: { address: { equals: queryValue, mode: 'insensitive' } },
        select: { username: true, address: true, memoType: true, memo: true },
      });

      if (!row) {
        const notFoundError = new Error('Address not found');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      const response = {
        stellar_address: `${row.username}*${process.env.DOMAIN || 'localhost'}`,
        account_id: row.address,
      };
      if (row.memoType) {
        response.memo_type = row.memoType;
        response.memo = row.memo;
      }
      return res.json(response);
    } else if (type === 'name' || !type) {
      const nameTag = normalizeNameTag(queryValue);
      const queryName = nameTag.toLowerCase();

      const row = await prisma.user.findUnique({
        where: { username: queryName },
        select: { address: true, memoType: true, memo: true },
      });

      const address = row?.address || USER_DATABASE[queryName];

      if (!address) {
        const notFoundError = new Error('Name tag not found');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      const response = {
        stellar_address: address,
        account_id: address,
      };
      if (row?.memoType) {
        response.memo_type = row.memoType;
        response.memo = row.memo;
      }
      return res.json(response);
    } else {
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

const VALID_MEMO_TYPES = ['text', 'id', 'hash'];
const MEMO_ID_RE = /^\d+$/;
const MEMO_HASH_RE = /^[0-9a-fA-F]{64}$/;

const validateMemo = (memoType, memo) => {
  if (!memoType && !memo) return null;
  if (memoType && !memo) return 'memo is required when memo_type is provided.';
  if (!memoType && memo) return 'memo_type is required when memo is provided.';
  if (!VALID_MEMO_TYPES.includes(memoType)) {
    return `memo_type must be one of: ${VALID_MEMO_TYPES.join(', ')}.`;
  }
  if (memoType === 'text' && Buffer.byteLength(memo, 'utf8') > 28) {
    return 'memo of type text must not exceed 28 bytes.';
  }
  if (memoType === 'id') {
    if (!MEMO_ID_RE.test(memo) || BigInt(memo) > 18446744073709551615n) {
      return 'memo of type id must be a valid 64-bit unsigned integer.';
    }
  }
  if (memoType === 'hash' && !MEMO_HASH_RE.test(memo)) {
    return 'memo of type hash must be a 64-character hex string (32 bytes).';
  }
  return null;
};

/**
 * Registration endpoint with multi-signer threshold verification
 * 
 * For single-signer accounts:
 * - Signature must be the account's public key or a registered signer
 * - Basic validation of address format
 * 
 * For multi-signer accounts (enterprise):
 * - Fetches account signers and thresholds from Horizon
 * - Validates that provided signature(s) meet minimum threshold
 * - Ensures authorization requirements are satisfied
 */
app.post('/register', async (req, res, next) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: "Unsupported Media Type. Please send application/json" });
  }
  const safeUsername = xss(req.body.username);
  const username = normalizeNameTag(safeUsername);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';
  const memoType = typeof req.body.memo_type === 'string' ? req.body.memo_type.trim() : undefined;
  const memo = typeof req.body.memo === 'string' ? req.body.memo.trim() : undefined;
  const signature = typeof req.body.signature === 'string' ? req.body.signature.trim() : '';

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

  const memoError = validateMemo(memoType, memo);
  if (memoError) {
    return res.status(400).json({ error: memoError });
  }

  // Signature is optional for legacy single-signer registrations.
  // If provided, validate its format and run multi-signer verification.
  if (signature && !StrKey.isValidEd25519PublicKey(signature)) {
    const error = new Error('Invalid Stellar Public Key format.');
    error.statusCode = 400;
    return next(error);
  }

  const normalizedUsername = username.toLowerCase();

  const RESERVED_NAMES = ['admin', 'root', 'support', 'system', 'stellar', 'api', 'help'];
  if (RESERVED_NAMES.includes(normalizedUsername)) {
    return res.status(403).json({ error: "This username is reserved and cannot be registered." });
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { address }
    });

    if (existing) {
      const conflictError = new Error('Address already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }

    let verificationResult = null;
    if (signature) {
      verificationResult = await verifyMultiSignerThreshold(address, [signature], {
        operationType: 'management',
      });

      if (!verificationResult.success) {
        const verificationError = new Error(
          verificationResult.errorMessage || 'Signature verification failed'
        );
        verificationError.statusCode = 401;
        throw verificationError;
      }
    }

    await prisma.user.create({
      data: {
        username: normalizedUsername,
        address,
        ...(memoType && { memoType, memo }),
      },
    });

    return res.status(201).json({
      ok: true,
      username: normalizedUsername,
      address,
      federation_address: `${normalizedUsername}*${process.env.DOMAIN || 'localhost'}`,
      ...(verificationResult && {
        verification: {
          accountId: verificationResult.accountId,
          signerCount: verificationResult.signerCount,
          thresholdMet: verificationResult.success,
          requiredThreshold: verificationResult.requiredThreshold,
          providedWeight: verificationResult.totalWeight,
        },
      }),
      ...(memoType && { memo_type: memoType, memo }),
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' || (error.message && error.message.includes('UNIQUE'))) {
      return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
    }
    
    // Handle verification errors
    if (error.message && error.message.includes('Account not found')) {
      const notFoundError = new Error(`Account not found on Horizon: ${address}`);
      notFoundError.statusCode = 404;
      return next(notFoundError);
    }

    // Handle signature verification errors
    if (error.statusCode === 401) {
      return next(error);
    }

    // Handle other errors
    console.error('Registration error:', error.message);
    const registrationError = new Error(`Registration verification failed: ${error.message}`);
    registrationError.statusCode = 500;
    return next(registrationError);
  }
});

app.all('/register', (req, res) => res.status(405).json({ error: "Method Not Allowed" }));

app.get('/lookup', async (req, res, next) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  if (!address && !search) {
    const error = new Error("Missing required parameter: provide 'address' for exact lookup or 'search' for paginated search");
    error.statusCode = 400;
    return next(error);
  }

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

app.get('/.well-known/stellar.toml', (_req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
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

app.use((err, _req, _res, next) => {
  if (err.type === 'entity.too.large') {
    const error = new Error('Payload too large. Maximum allowed size is 10kb.');
    error.statusCode = 413;
    return next(error);
  }
  next(err);
});

app.use((err, _req, res, next) => {
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
app.use((err, req, res) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
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

  const prismaPool = {
    drain: () => Promise.resolve(),
    clear: () => prisma.$disconnect(),
  };

  process.on('SIGTERM', (sig) => gracefulShutdown(server, prismaPool, sig));
  process.on('SIGINT', (sig) => gracefulShutdown(server, prismaPool, sig));
}

module.exports = { app, prisma, gracefulShutdown, rejectNestedObjects };
