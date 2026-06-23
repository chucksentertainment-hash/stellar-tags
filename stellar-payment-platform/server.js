const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const { Prisma } = require('@prisma/client');
const { prisma } = require('./prismaClient');

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
// Database — PostgreSQL via Prisma ORM
// ---------------------------------------------------------------------------
// The legacy raw sqlite3 layer (manual generic-pool, hand-written SQL and
// schema bootstrap) has been replaced by the Prisma Client. Prisma owns its
// own connection pool, configurable through the DATABASE_URL query string
// (e.g. ?connection_limit=10&pool_timeout=5). The schema lives in
// prisma/schema.prisma and is applied with `npm run prisma:migrate`.

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

app.get('/federation', etagCache, async (req, res) => {
  const nameTag = normalizeNameTag(req.query.q);

  if (!nameTag) {
    return res.status(400).json({ detail: "Missing 'q' parameter" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username: nameTag },
    });

    const address = user?.address || USER_DATABASE[nameTag];
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
    const existing = await prisma.user.findUnique({
      where: { address },
    });

    if (existing) {
      return res.status(409).json({ detail: 'Address already registered' });
    }

    await prisma.user.create({
      data: { username, address },
    });

    return res.json({ ok: true, username, address });
  } catch (error) {
    // P2002 — unique constraint violation (username or address already taken)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const isAddress = Array.isArray(target) ? target.includes('address') : target === 'address';
      return res.status(409).json({
        detail: isAddress ? 'Address already registered' : 'Username already registered',
      });
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
    const user = await prisma.user.findUnique({
      where: { address },
    });

    if (!user) {
      return res.status(404).json({ detail: 'Username not found for this address' });
    }

    return res.json({ username: user.username, address });
  } catch {
    return res.status(500).json({ detail: 'Database lookup failed' });
  }
});

app.get('/users', async (req, res) => {
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
    return res.status(500).json({ detail: 'Database error' });
  }
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

    // Graceful shutdown — close the Prisma connection pool
    const shutdown = async () => {
      console.log('\nShutting down gracefully...');
      await prisma.$disconnect();
      server.close(() => process.exit(0));
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

// Export for testing and for the Horizon listener
module.exports = { app, prisma };
