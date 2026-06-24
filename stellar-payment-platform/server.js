const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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

const dbPool = genericPool.createPool(
  {
    create: () =>
      new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(dbConfig.filePath, (err) => {
          if (err) return reject(err);
          connection.run('PRAGMA journal_mode=WAL', () => resolve(connection));
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
  dbPool.acquire().then(
    (conn) =>
      new Promise((resolve, reject) => {
        conn.get(sql, params, (err, row) => {
          dbPool.release(conn);
          if (err) return reject(err);
          resolve(row);
        });
      }),
  );

const poolRun = (sql, params) =>
  dbPool.acquire().then(
    (conn) =>
      new Promise((resolve, reject) => {
        conn.run(sql, params, function runCb(err) {
          dbPool.release(conn);
          if (err) return reject(err);
          resolve(this);
        });
      }),
  );

const poolAll = (sql, params) =>
  dbPool.acquire().then(
    (conn) =>
      new Promise((resolve, reject) => {
        conn.all(sql, params, (err, rows) => {
          dbPool.release(conn);
          if (err) return reject(err);
          resolve(rows);
        });
      }),
  );

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

const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS username_registry (
      username TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
});

// Start the weekly background job that prunes/flags stale registrations.
scheduleCleanupJob(db);

app.get('/federation', (req, res) => {
app.get('/federation', async (req, res) => {

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
    const row = await poolGet(
      'SELECT address FROM username_registry WHERE username = ?',
      [nameTag],
    );

    const address = row?.address || USER_DATABASE[nameTag];
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
  } catch (err) {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

app.post('/register', async (req, res, next) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

  if (!username || !address) {
    const error = new Error('username and address are required');
    error.statusCode = 400;
    return next(error);
  }

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
      [username, address, new Date().toISOString()],
    );

    return res.json({ ok: true, username, address });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      const conflictError = new Error('Username already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }
    return res.status(500).json({ detail: 'Failed to save registration' });
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

// #49 — Error handling middleware for payload size limit violations
// Express emits a 'entity.too.large' error type when the JSON body exceeds the limit.
// This middleware catches it and returns a clean 413 JSON response.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    const error = new Error('Payload too large. Maximum allowed size is 10kb.');
    error.statusCode = 413;
    return next(error);
  }
  next();
});

// Global error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal server error';
  
  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    statusCode: statusCode
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

  // Graceful shutdown — drain the connection pool
  const shutdown = async () => {
    console.log('\nShutting down gracefully...');
    await dbPool.drain();
    await dbPool.clear();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { app, poolGet, poolAll, rejectNestedObjects };