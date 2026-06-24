require('./config/envCheck');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const sqlite3 = require('sqlite3').verbose();
<<<<<<< chore/env-validation
const { Keypair } = require('@stellar/stellar-sdk');
const helmet = require('helmet');
=======
const { scheduleCleanupJob } = require('./src/cleanup-cron');
const dotenv = require('dotenv');

dotenv.config();

const genericPool = require('generic-pool');
>>>>>>> main

const app = express();
const PORT = process.env.PORT || 5000;
const STELLAR_TAG_DOMAIN = process.env.STELLAR_TAG_DOMAIN;

<<<<<<< chore/env-validation
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'https://horizon-testnet.stellar.org', 'https://horizon.stellar.org'],
    },
  },
}));
app.use(cors());
=======
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
>>>>>>> main
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
