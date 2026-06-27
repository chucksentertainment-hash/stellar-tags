'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn(() => true) },
}));

jest.mock('pdfkit', () => jest.fn());

// The cleanup cron schedules a recurring job at module load — stub it so the
// test process does not register a real timer.
jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

jest.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

// Prisma is mocked so the suite never touches a real database.
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

describe('gracefulShutdown', () => {
  let gracefulShutdown;
  let mockServer;
  let mockPool;
  let exitSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    ({ gracefulShutdown } = require('./server'));

    mockServer = { close: jest.fn() };
    mockPool = {
      drain: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('SIGTERM — calls server.close()', () => {
    gracefulShutdown(mockServer, mockPool, 'SIGTERM');
    expect(mockServer.close).toHaveBeenCalledTimes(1);
  });

  test('SIGINT — calls server.close()', () => {
    gracefulShutdown(mockServer, mockPool, 'SIGINT');
    expect(mockServer.close).toHaveBeenCalledTimes(1);
  });

  test('drains then clears pool and exits 0 after server.close() completes', async () => {
    mockServer.close.mockImplementation((cb) => cb());

    gracefulShutdown(mockServer, mockPool, 'SIGTERM');
    // The async server.close callback chains: drain → clear → exit(0).
    // Each await is one microtask tick; flush three to reach process.exit(0).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockPool.drain).toHaveBeenCalledTimes(1);
    expect(mockPool.clear).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('pool is drained after server.close() — not before', async () => {
    const callOrder = [];
    mockServer.close.mockImplementation((cb) => {
      callOrder.push('server.close');
      cb();
    });
    mockPool.drain.mockImplementation(() => {
      callOrder.push('pool.drain');
      return Promise.resolve();
    });

    gracefulShutdown(mockServer, mockPool, 'SIGTERM');
    await Promise.resolve();

    expect(callOrder).toEqual(['server.close', 'pool.drain']);
  });

  test('force-exits with code 1 if requests do not drain within 10 s', () => {
    mockServer.close.mockImplementation(() => {}); // never calls back

    gracefulShutdown(mockServer, mockPool, 'SIGTERM');
    jest.advanceTimersByTime(10_000);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockPool.drain).not.toHaveBeenCalled();
  });

  test('second signal is a no-op (double-invocation guard)', () => {
    gracefulShutdown(mockServer, mockPool, 'SIGTERM');
    gracefulShutdown(mockServer, mockPool, 'SIGTERM');

    expect(mockServer.close).toHaveBeenCalledTimes(1);
  });
});

describe('rejectNestedObjects middleware', () => {
  let rejectNestedObjects;
  let res;
  let next;

  beforeAll(() => {
    ({ rejectNestedObjects } = require('./server'));
  });

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test('passes through when body contains only string values', () => {
    rejectNestedObjects({ query: {}, body: { username: 'alice*localhost', address: 'GABC123' } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes through when query contains only string values', () => {
    rejectNestedObjects({ query: { q: 'alice*localhost' }, body: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes through when query and body are empty', () => {
    rejectNestedObjects({ query: {}, body: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes through when body is undefined (no-body GET requests)', () => {
    rejectNestedObjects({ query: { address: 'GABC123' }, body: undefined }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects 400 when body value is a nested object', () => {
    rejectNestedObjects({ query: {}, body: { username: { $ne: '' } } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      detail: 'Invalid parameter type: nested objects and arrays are not allowed.',
    });
  });

  test('rejects 400 when query value is a nested object', () => {
    rejectNestedObjects({ query: { q: { $ne: '' } }, body: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects 400 when body value is an array', () => {
    rejectNestedObjects({ query: {}, body: { username: ['alice', 'bob'] } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects 400 when query value is an array', () => {
    rejectNestedObjects({ query: { address: ['GABC', 'GXYZ'] }, body: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('passes through null values (legitimate optional param absence)', () => {
    rejectNestedObjects({ query: { search: null }, body: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('GET /lookup — pagination and search', () => {
  let request;
  let app;
  let prisma;

  const VALID_ADDRESS = 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ';

  beforeEach(() => {
    jest.resetModules();
    ({ app } = require('./server'));
    ({ prisma } = require('./prismaClient'));
    request = require('supertest');

    prisma.user.findUnique.mockReset();
    prisma.user.findMany.mockReset();
    prisma.user.count.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns 400 when neither address nor search is provided', async () => {
    const res = await request(app).get('/lookup');
    expect(res.status).toBe(400);
  });

  test('exact address lookup returns single record (backward compat)', async () => {
    prisma.user.findUnique.mockResolvedValue({ username: 'alice*localhost' });

    const res = await request(app).get(`/lookup?address=${VALID_ADDRESS}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'alice*localhost', address: VALID_ADDRESS });
    expect(res.body).not.toHaveProperty('data');
  });

  test('search mode returns paginated metadata block', async () => {
    prisma.user.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([
      { username: 'alice*localhost', address: VALID_ADDRESS, createdAt: new Date('2024-01-01T00:00:00.000Z') },
      { username: 'bob*localhost', address: 'GBOB0000000000000000000000000000000000000000000000000000', createdAt: new Date('2024-01-02T00:00:00.000Z') },
    ]);

    const res = await request(app).get('/lookup?search=alice&page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('totalCount');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('currentPage', 1);
  });

  test('search mode defaults page to 1 and limit to 10 when omitted', async () => {
    prisma.user.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app).get('/lookup?search=alice');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentPage: 1 });
  });
});

describe('GET /users — pagination and search', () => {
  let request;
  let app;
  let prisma;

  beforeEach(() => {
    jest.resetModules();
    ({ app } = require('./server'));
    ({ prisma } = require('./prismaClient'));
    request = require('supertest');

    prisma.user.findMany.mockReset();
    prisma.user.count.mockReset();

    prisma.user.count.mockResolvedValue(25);
    prisma.user.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        username: `user${i}*localhost`,
        address: `G${'A'.repeat(55)}${i}`,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      })),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns paginated metadata block with default page and limit', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalCount: 25, currentPage: 1 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('respects explicit page and limit query params', async () => {
    const res = await request(app).get('/users?page=3&limit=5');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentPage: 3 });
  });

  test('accepts search query param without error', async () => {
    const res = await request(app).get('/users?search=alice');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /register — block secret keys', () => {
  let request;
  let app;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn() }));
    jest.mock('@stellar/stellar-sdk', () => ({
      Horizon: { Server: jest.fn() },
      StrKey: { isValidEd25519PublicKey: jest.fn((addr) => addr && (addr.startsWith('G') || addr.startsWith('S') || addr.startsWith('s'))) }
    }));
    jest.mock('pdfkit', () => jest.fn());
    jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

    ({ app } = require('./server'));
    request = require('supertest');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('blocks registration if address starts with S (uppercase)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: 'SBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Never share your Secret Key. Please register using your Public Key (starts with G)."
    });
  });

  test('blocks registration if address starts with s (lowercase)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: 'sBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Never share your Secret Key. Please register using your Public Key (starts with G)."
    });
  });

  test('allows registration and continues flow if address starts with G', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      username: 'alice*localhost',
      address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ'
    });
  });

  test('rejects registration if Content-Type header is not application/json', async () => {
    const res = await request(app)
      .post('/register')
      .set('Content-Type', 'text/plain')
      .send('username=alice&address=GBCDEFGHIJKLMNOPQRSTUVWXYZ');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: "Unsupported Media Type. Please send application/json"
    });
  });

  test('rejects registration if Content-Type header is missing', async () => {
    const res = await request(app)
      .post('/register')
      .unset('Content-Type')
      .send('some-raw-payload');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: "Unsupported Media Type. Please send application/json"
    });
  });

  test('rejects 1-character local username payload', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'a', address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Username must be at least 3 characters long."
    });
  });

  test('rejects 2-character local username payload', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'ab', address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Username must be at least 3 characters long."
    });
  });

  test('rejects 2-character local username payload with domain suffix', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'ab*domain.com', address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Username must be at least 3 characters long."
    });
  });

  test('allows 3-character username payload', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'abc', address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      username: 'abc*localhost',
      address: 'GBCDEFGHIJKLMNOPQRSTUVWXYZ'
    });
  });
});

describe('POST /register — memo validation', () => {
  let request;
  let app;
  let prisma;

  const VALID_ADDRESS = 'GBCDEFGHIJKLMNOPQRSTUVWXYZ';

  beforeEach(() => {
    jest.resetModules();
    ({ app } = require('./server'));
    ({ prisma } = require('./prismaClient'));
    request = require('supertest');

    prisma.user.findUnique.mockReset();
    prisma.user.create.mockReset();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      username: 'alice*localhost',
      address: VALID_ADDRESS,
      memoType: null,
      memo: null,
    });
  });

  test('registers without memo fields', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('memo_type');
    expect(res.body).not.toHaveProperty('memo');
  });

  test('accepts valid text memo (≤28 bytes)', async () => {
    prisma.user.create.mockResolvedValue({ username: 'alice*localhost', address: VALID_ADDRESS, memoType: 'text', memo: 'pay123' });
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'text', memo: 'pay123' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ memo_type: 'text', memo: 'pay123' });
  });

  test('rejects text memo exceeding 28 bytes', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'text', memo: 'a'.repeat(29) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/28 bytes/);
  });

  test('accepts valid id memo (64-bit uint)', async () => {
    prisma.user.create.mockResolvedValue({ username: 'alice*localhost', address: VALID_ADDRESS, memoType: 'id', memo: '12345678' });
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'id', memo: '12345678' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ memo_type: 'id', memo: '12345678' });
  });

  test('rejects id memo with non-numeric value', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'id', memo: 'notanumber' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/64-bit unsigned integer/);
  });

  test('accepts valid hash memo (64 hex chars)', async () => {
    const validHash = 'a'.repeat(64);
    prisma.user.create.mockResolvedValue({ username: 'alice*localhost', address: VALID_ADDRESS, memoType: 'hash', memo: validHash });
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'hash', memo: validHash });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ memo_type: 'hash', memo: validHash });
  });

  test('rejects hash memo that is not 64 hex chars', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'hash', memo: 'tooshort' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/64-character hex/);
  });

  test('rejects unknown memo_type', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'return', memo: 'something' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/memo_type must be one of/);
  });

  test('rejects memo without memo_type', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo: 'orphan' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/memo_type is required/);
  });

  test('rejects memo_type without memo', async () => {
    const res = await request(app)
      .post('/register')
      .send({ username: 'alice', address: VALID_ADDRESS, memo_type: 'text' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/memo is required/);
  });
});

describe('GET /federation — memo fields in response', () => {
  let request;
  let app;
  let prisma;

  const VALID_ADDRESS = 'GBCDEFGHIJKLMNOPQRSTUVWXYZ';

  beforeEach(() => {
    jest.resetModules();
    ({ app } = require('./server'));
    ({ prisma } = require('./prismaClient'));
    request = require('supertest');

    prisma.user.findUnique.mockReset();
    prisma.user.findFirst.mockReset();
  });

  test('omits memo fields when user has no memo configured', async () => {
    prisma.user.findUnique.mockResolvedValue({ address: VALID_ADDRESS, memoType: null, memo: null });
    const res = await request(app).get('/federation?q=alice*localhost&type=name');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('memo_type');
    expect(res.body).not.toHaveProperty('memo');
  });

  test('returns stored text memo in federation response', async () => {
    prisma.user.findUnique.mockResolvedValue({ address: VALID_ADDRESS, memoType: 'text', memo: 'pay123' });
    const res = await request(app).get('/federation?q=alice*localhost&type=name');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memo_type: 'text', memo: 'pay123' });
  });

  test('returns stored id memo in type=id federation response', async () => {
    prisma.user.findFirst.mockResolvedValue({ username: 'alice*localhost', address: VALID_ADDRESS, memoType: 'id', memo: '999' });
    const res = await request(app).get(`/federation?q=${VALID_ADDRESS}&type=id`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memo_type: 'id', memo: '999' });
  });

  test('omits memo fields for type=id lookup when no memo set', async () => {
    prisma.user.findFirst.mockResolvedValue({ username: 'alice*localhost', address: VALID_ADDRESS, memoType: null, memo: null });
    const res = await request(app).get(`/federation?q=${VALID_ADDRESS}&type=id`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('memo_type');
    expect(res.body).not.toHaveProperty('memo');
  });
});

