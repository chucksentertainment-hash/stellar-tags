const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const genericPool = require('generic-pool');

const app = express();
const PORT = process.env.PORT || 5000;


app.use(cors());
// #49 — Enforce strict 10kb JSON payload size limit to prevent DoS via oversized payloads
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// #50 — Database Connection Pooling
// ---------------------------------------------------------------------------
// Append connection_limit and pool_timeout to the connection string as
// documented in the issue, then parse them to configure the pool.
const rawDbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'registrations.db');

// Parse optional pool parameters from the connection string
// e.g. DB_PATH="./data/registrations.db?connection_limit=10&pool_timeout=5"
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

// Create a connection pool for SQLite database handles using generic-pool.
// Connections are recycled back to the pool rather than being opened/closed
// on every request, which improves performance under concurrent load.
const dbPool = genericPool.createPool(
  {
    create: () =>
      new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(dbConfig.filePath, (err) => {
          if (err) return reject(err);
          // Enable WAL mode for better concurrent read performance
          connection.run('PRAGMA journal_mode=WAL', () => resolve(connection));
        });
      }),
    destroy: (connection) =>
      new Promise((resolve) => {
        connection.close(() => resolve());
      }),
  },
  {
    max: dbConfig.connectionLimit,  // Maximum 10 active connections
    min: 1,                         // Keep at least 1 idle connection
    acquireTimeoutMillis: dbConfig.poolTimeout * 1000, // 5-second timeout
    idleTimeoutMillis: 30000,       // Recycle idle connections after 30s
  },
);

// Helper: acquire a connection, run a query, and release back to pool
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

// Initialise the schema using a pooled connection
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


app.get('/federation', async (req, res) => {
  const nameTag = normalizeNameTag(req.query.q);

  if (!nameTag) {
    return res.status(400).json({ detail: "Missing 'q' parameter" });
  }

  try {
    const row = await poolGet(
      'SELECT address FROM username_registry WHERE username = ?',
      [nameTag],
    );

    const address = row?.address || USER_DATABASE[nameTag];
    if (!address) {
      return res.status(404).json({ detail: 'Name tag not found' });
    }

    return res.json({
      stellar_address: address,
      account_id: address,
      memo_type: 'text',
      memo: 'PlatformPayment',
    });
  } catch {
    return res.status(500).json({ detail: 'Database lookup failed' });
  }
});

app.post('/register', async (req, res) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

  if (!username || !address) {
    return res.status(400).json({ detail: 'username and address are required' });
  }

  try {
    const row = await poolGet(
      'SELECT username FROM username_registry WHERE address = ?',
      [address],
    );

    if (row) {
      return res.status(409).json({ detail: 'Address already registered' });
    }

    await poolRun(
      'INSERT INTO username_registry (username, address, created_at) VALUES (?, ?, ?)',
      [username, address, new Date().toISOString()],
    );

    return res.json({ ok: true, username, address });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(409).json({ detail: 'Username already registered' });
    }

    return res.status(500).json({ detail: 'Failed to save registration' });
  }
});

app.get('/lookup', async (req, res) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';

  if (!address) {
    return res.status(400).json({ detail: "Missing 'address' parameter" });
  }

  try {
    const row = await poolGet(
      'SELECT username FROM username_registry WHERE address = ?',
      [address],
    );

    if (!row) {
      return res.status(404).json({ detail: 'Username not found for this address' });
    }

    return res.json({ username: row.username, address });
  } catch {
    return res.status(500).json({ detail: 'Database lookup failed' });
  }
});

app.get('/users', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const search = typeof req.query.search === 'string' ? `%${req.query.search}%` : null;
  const offset = (page - 1) * limit;

  const where = search ? 'WHERE username LIKE ? OR address LIKE ?' : '';
  const params = search ? [search, search] : [];

  db.get(`SELECT COUNT(*) AS total FROM username_registry ${where}`, params, (err, countRow) => {
    if (err) return res.status(500).json({ detail: 'Database error' });

    const totalCount = countRow.total;
    const totalPages = Math.ceil(totalCount / limit);

    db.all(
      `SELECT username, address, created_at FROM username_registry ${where} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (err, rows) => {
        if (err) return res.status(500).json({ detail: 'Database error' });
        res.json({ data: rows, totalCount, totalPages, currentPage: page });
      },
    );
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// #49 — Error handling middleware for payload size limit violations
// Express emits a 'entity.too.large' error type when the JSON body exceeds the limit.
// This middleware catches it and returns a clean 413 JSON response.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      detail: 'Payload too large. Maximum allowed size is 10kb.',
    });
  }
  return res.status(500).json({ detail: 'Internal server error' });
});

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

// Export for testing and for the Horizon listener
module.exports = { app, poolGet, poolAll };
