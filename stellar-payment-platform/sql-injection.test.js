'use strict';

// ---------------------------------------------------------------------------
// #35 — Injection-safety audit (Prisma edition)
// ---------------------------------------------------------------------------
// The original audit asserted that hand-written SQL used `?` placeholders. With
// the migration to the Prisma ORM there is no hand-written SQL in application
// code at all — queries are built from structured objects, so user input can
// never be interpolated into a query string.
//
// These tests drive the public endpoints with classic injection payloads and
// assert that:
//   a) the app always returns a well-formed HTTP response (never crashes), and
//   b) the payload reaches Prisma only as a *bound argument value* inside the
//      structured `where` object — proving it is treated as data, not query.
// ---------------------------------------------------------------------------

const request = require('supertest');

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('pdfkit', () => jest.fn());
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn(() => true) },
}));
jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

jest.mock('./prismaClient', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
}));

const { app } = require('./server');
const { prisma } = require('./prismaClient');

// ---------------------------------------------------------------------------
// Common SQL injection payloads
// ---------------------------------------------------------------------------
const INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE username_registry; --",
  "' UNION SELECT username, address, created_at FROM username_registry --",
  "1; SELECT * FROM username_registry",
  "' OR 1=1 --",
  "admin'--",
  '" OR ""="',
  "1' AND SLEEP(5)--",
];

// Recursively collect every string nested inside a Prisma `where` object.
const collectStrings = (obj, out = []) => {
  if (typeof obj === 'string') {
    out.push(obj);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) collectStrings(v, out);
  }
  return out;
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue({});
  prisma.user.count.mockResolvedValue(0);
  prisma.user.findMany.mockResolvedValue([]);
});

describe('#35 Injection safety — GET /federation (username lookup)', () => {
  test.each(INJECTION_PAYLOADS)(
    'payload is bound as a Prisma argument, never interpolated: %s',
    async (payload) => {
      const res = await request(app).get('/federation').query({ q: payload });

      // Well-formed response — handled, never an unhandled crash.
      expect([200, 404]).toContain(res.status);

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      const arg = prisma.user.findUnique.mock.calls[0][0];

      const normalized = (payload.includes('*') ? payload : `${payload}*localhost`).toLowerCase();
      // The entire payload is a single bound value of `where.username`.
      expect(arg.where.username).toBe(normalized);
      expect(collectStrings(arg.where)).toContain(normalized);
    },
  );
});

describe('#35 Injection safety — GET /lookup (exact address lookup)', () => {
  test.each(INJECTION_PAYLOADS)(
    'address payload is bound as a Prisma argument: %s',
    async (payload) => {
      const res = await request(app).get('/lookup').query({ address: payload });

      expect([200, 404]).toContain(res.status);

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      const arg = prisma.user.findUnique.mock.calls[0][0];
      expect(arg.where.address).toBe(payload);
    },
  );
});

describe('#35 Injection safety — GET /users (paginated search)', () => {
  test.each(INJECTION_PAYLOADS)(
    'search payload is bound inside a structured contains filter: %s',
    async (payload) => {
      const res = await request(app).get('/users').query({ search: payload });

      expect(res.status).toBe(200);

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      const arg = prisma.user.findMany.mock.calls[0][0];
      // The payload appears only as the value of a `contains` filter.
      const strings = collectStrings(arg.where);
      expect(strings).toContain(payload);
    },
  );
});

describe('#35 Injection safety — POST /register (address conflict check)', () => {
  test.each(INJECTION_PAYLOADS)(
    'address payload is bound as a Prisma argument: %s',
    async (payload) => {
      const res = await request(app)
        .post('/register')
        .send({ username: 'attacker', address: payload });

      // Either created (201) or rejected as a conflict (409) — never a crash.
      expect([201, 409]).toContain(res.status);

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      const arg = prisma.user.findUnique.mock.calls[0][0];
      expect(arg.where.address).toBe(payload);
    },
  );
});
