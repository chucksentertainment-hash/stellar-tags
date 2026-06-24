const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const sqlite3 = require('sqlite3').verbose();
const { Horizon } = require('@stellar/stellar-sdk');
const PDFDocument = require('pdfkit');
const { scheduleCleanupJob } = require('./src/cleanup-cron');
const dotenv = require('dotenv');

dotenv.config();

const genericPool = require('generic-pool');

const HORIZON_BASE = 'https://horizon-testnet.stellar.org';
const TX_HASH_RE = /^[a-fA-F0-9]{64}$/;

const app = express();
app.set('query parser', 'simple');
const PORT = process.env.PORT || 5000;
const STELLAR_TAG_DOMAIN = process.env.STELLAR_TAG_DOMAIN;

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

app.use(cors(corsOptions));
app.use(express.json());
// #49 — Enforce strict 10kb JSON payload size limit to prevent DoS via oversized payloads
app.use(express.json({ limit: '10kb' }));
app.use((err, req, res, next) => {
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

const rawDbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'registrations.db');

const parseDbPath = (raw) => {
  const [filePath, queryString] = raw.split('?');
  const params = {};
  if (queryString) {
    queryString.split('&').forEach((pair) => {
      const [key, value] = pair.split('=');
      params[key] = value;
    });
  }
  return {
    filePath,
    connectionLimit: parseInt(params.connection_limit, 10) || 10,
    poolTimeout: parseInt(params.pool_timeout, 10) || 5,
  };
};

const dbConfig = parseDbPath(rawDbPath);
fs.mkdirSync(path.dirname(dbConfig.filePath), { recursive: true });

const attachAsyncDbMethods = (db) => {
  if (typeof db.get === 'function') {
    db.getAsync = promisify(db.get.bind(db));
  }
  if (typeof db.run === 'function') {
    db.runAsync = promisify(db.run.bind(db));
  }
  if (typeof db.all === 'function') {
    db.allAsync = promisify(db.all.bind(db));
  }
  return db;
};

const getAsync = async (db, sql, params = []) => {
  if (typeof db.getAsync === 'function') {
    return db.getAsync(sql, params);
  }
  return promisify(db.get.bind(db))(sql, params);
};

const runAsync = async (db, sql, params = []) => {
  if (typeof db.runAsync === 'function') {
    return db.runAsync(sql, params);
  }
  return promisify(db.run.bind(db))(sql, params);
};

const allAsync = async (db, sql, params = []) => {
  if (typeof db.allAsync === 'function') {
    return db.allAsync(sql, params);
  }
  return promisify(db.all.bind(db))(sql, params);
};

const dbPool = genericPool.createPool(
  {
    create: () =>
      new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(dbConfig.filePath, (err) => {
          if (err) return reject(err);
          attachAsyncDbMethods(connection);
          connection.runAsync('PRAGMA journal_mode=WAL')
            .then(() => resolve(connection))
            .catch(reject);
        });
      }),
    destroy: (connection) =>
      new Promise((resolve) => {
        connection.close(() => resolve());
      }),
  },
  {
    max: dbConfig.connectionLimit,
    min: 1,
    acquireTimeoutMillis: dbConfig.poolTimeout * 1000,
    idleTimeoutMillis: 30000,
  },
);

const poolGet = (sql, params) =>
  dbPool.acquire().then(async (conn) => {
    try {
      return await getAsync(conn, sql, params);
    } finally {
      dbPool.release(conn);
    }
  });

const poolRun = (sql, params) =>
  dbPool.acquire().then(async (conn) => {
    try {
      return await runAsync(conn, sql, params);
    } finally {
      dbPool.release(conn);
    }
  });

const poolAll = (sql, params) =>
  dbPool.acquire().then(async (conn) => {
    try {
      return await allAsync(conn, sql, params);
    } finally {
      dbPool.release(conn);
    }
  });

(async () => {
  try {
    await poolRun(
      `CREATE TABLE IF NOT EXISTS username_registry (
        username TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      [],
    );
    console.log(`Database pool initialised — max ${dbConfig.connectionLimit} connections, ${dbConfig.poolTimeout}s timeout`);
  } catch (err) {
    console.error('Failed to initialise database schema:', err);
    process.exit(1);
  }
})();

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

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'registrations.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = attachAsyncDbMethods(new sqlite3.Database(dbPath));

(async () => {
  try {
    await db.runAsync(
      `CREATE TABLE IF NOT EXISTS username_registry (
        username TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
  } catch (err) {
    console.error('Failed to initialize direct database schema:', err);
  }
})();

// Start the weekly background job that prunes/flags stale registrations.
scheduleCleanupJob(db);

// ---------------------------------------------------------------------------
// #51 — ETag Caching Middleware for Federation Endpoint
// ---------------------------------------------------------------------------
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
    let row;
    let queryName;

    // Branch logic based on type parameter (SEP-0002 compliance)
    if (type === 'id') {
      // Reverse lookup: search by Stellar address
      // Convert to lowercase for case-insensitive lookup
      const addressLower = queryValue.toLowerCase();
      row = await poolGet(
        'SELECT username, address FROM username_registry WHERE LOWER(address) = ?',
        [addressLower]
      );

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
        memo: 'PlatformPayment'
      });
    } else if (type === 'name' || !type) {
      // Default: lookup by username (backward compatible)
      // Normalize the name tag (e.g., "alice*localhost")
      const nameTag = normalizeNameTag(queryValue);
      queryName = nameTag.toLowerCase();

      row = await poolGet(
        'SELECT address FROM username_registry WHERE username = ?',
        [queryName]
      );

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
        memo: 'PlatformPayment'
      });
    } else {
      // Unsupported type parameter
      return res.status(400).json({
        error: "Unsupported query type. Supported types: 'id', 'name'"
      });
    }
  } catch (err) {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

const { StrKey } = require('@stellar/stellar-sdk');

app.post('/register', async (req, res, next) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';
  const signature = typeof req.body.signature === 'string' ? req.body.signature.trim() : '';

  if (!username || !address) {
    return res.status(400).json({ error: 'Missing required fields: username and address are both required.' });
  }

  if (!StrKey.isValidEd25519PublicKey(address)) {
    const error = new Error('Invalid Stellar Public Key format.');
    error.statusCode = 400;
    return next(error);
  }

  // Convert to lowercase for case-insensitive storage
  const normalizedUsername = username.toLowerCase();

  try {
    const row = await poolGet(
      'SELECT username FROM username_registry WHERE address = ?',
      [address],
    );

    if (row) {
      const conflictError = new Error('Address already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }

    await poolRun(
      'INSERT INTO username_registry (username, address, created_at) VALUES (?, ?, ?)',
      [normalizedUsername, address, new Date().toISOString()],
    );

    return res.status(201).json({ ok: true, username: normalizedUsername, address, federation_address: `${normalizedUsername}*${process.env.DOMAIN || 'localhost'}` });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      const conflictError = new Error('Username already registered');
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
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  if (!address && !search) {
    const error = new Error("Missing required parameter: provide 'address' for exact lookup or 'search' for paginated search");
    error.statusCode = 400;
    return next(error);
  }

  // Exact lookup by address — original behaviour, returns a single record
  if (address) {
    try {
      const row = await poolGet(
        'SELECT username FROM username_registry WHERE address = ?',
        [address],
      );

      if (!row) {
        const notFoundError = new Error('Username not found for this address');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      return res.json({ username: row.username, address });
    } catch (err) {
      const dbError = new Error('Database lookup failed');
      dbError.statusCode = 500;
      return next(dbError);
    }
  }

  // Paginated search by partial username or address
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const pattern = `%${search}%`;

  try {
    const countRow = await poolGet(
      'SELECT COUNT(*) AS total FROM username_registry WHERE username LIKE ? OR address LIKE ?',
      [pattern, pattern],
    );
    const totalCount = countRow.total;
    const totalPages = Math.ceil(totalCount / limit);

    const rows = await poolAll(
      'SELECT username, address, created_at FROM username_registry WHERE username LIKE ? OR address LIKE ? LIMIT ? OFFSET ?',
      [pattern, pattern, limit, offset],
    );

    return res.json({ data: rows, totalCount, totalPages, currentPage: page });
  } catch (err) {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.get('/users', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const search = typeof req.query.search === 'string' ? `%${req.query.search}%` : null;
  const offset = (page - 1) * limit;

  const where = search ? 'WHERE username LIKE ? OR address LIKE ?' : '';
  const params = search ? [search, search] : [];

  try {
    const countRow = await poolGet(`SELECT COUNT(*) AS total FROM username_registry ${where}`, params);
    const totalCount = countRow.total;
    const totalPages = Math.ceil(totalCount / limit);

    const rows = await poolAll(
      `SELECT username, address, created_at FROM username_registry ${where} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows, totalCount, totalPages, currentPage: page });
  } catch (err) {
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

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    const error = new Error('Payload too large. Maximum allowed size is 10kb.');
    error.statusCode = 413;
    return next(error);
  }
  next(err);
});

// Global error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal server error';

  if (statusCode === 500) {
    const errorId = crypto.randomUUID();
    console.error(`[Error ID: ${errorId}]`, err);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      reference_id: errorId
    });
  }

  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    statusCode: statusCode
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

  process.on('SIGTERM', (sig) => gracefulShutdown(server, dbPool, sig));
  process.on('SIGINT',  (sig) => gracefulShutdown(server, dbPool, sig));
}

module.exports = { app, poolGet, poolAll, gracefulShutdown, rejectNestedObjects };