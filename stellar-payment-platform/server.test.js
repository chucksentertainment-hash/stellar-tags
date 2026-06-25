/* global jest, describe, test, expect, beforeEach, afterEach, beforeAll */
'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() },
}));

jest.mock('pdfkit', () => jest.fn());

jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

jest.mock('sqlite3', () => ({
  verbose: () => ({
    Database: jest.fn().mockImplementation((_path, cb) => {
      const db = {
        run: jest.fn(function (...args) {
          const fn = args.find((a) => typeof a === 'function');
          if (fn) fn.call({ lastID: 0, changes: 0 }, null);
        }),
        serialize: jest.fn((fn) => fn && fn()),
        close: jest.fn((cb) => cb && cb()),
      };
      if (cb) cb(null);
      return db;
    }),
  }),
}));

jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

jest.mock('generic-pool', () => ({
  createPool: jest.fn(() => ({
    acquire: jest.fn().mockResolvedValue({
      run: jest.fn(function (...args) {
        const fn = args.find((a) => typeof a === 'function');
        if (fn) fn.call({ lastID: 1, changes: 1 }, null);
      }),
    }),
    release: jest.fn(),
    drain: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  })),
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

  const VALID_ADDRESS = 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ';

  beforeEach(() => {
    jest.resetModules();

    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn() }));
    jest.mock('@stellar/stellar-sdk', () => ({ Horizon: { Server: jest.fn() }, StrKey: { isValidEd25519PublicKey: jest.fn(() => true) } }));
    jest.mock('pdfkit', () => jest.fn());
    jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

    jest.mock('sqlite3', () => ({
      verbose: () => ({
        Database: jest.fn().mockImplementation((_path, cb) => {
          const db = { run: jest.fn((sql, cb2) => cb2 && cb2(null)), close: jest.fn((cb2) => cb2 && cb2()) };
          if (cb) cb(null);
          return db;
        }),
      }),
    }));

    const mockConn = {
      run: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        if (fn) fn.call({ lastID: 0, changes: 0 }, null);
      }),
      get: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        if (sql.includes('COUNT(*)')) {
          if (fn) fn(null, { total: 2 });
        } else if (sql.includes('WHERE address =')) {
          if (fn) fn(null, { username: 'alice*localhost' });
        } else {
          if (fn) fn(null, null);
        }
      }),
      all: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        const rows = [
          { username: 'alice*localhost', address: VALID_ADDRESS, created_at: '2024-01-01T00:00:00.000Z' },
          { username: 'bob*localhost', address: 'GBOB0000000000000000000000000000000000000000000000000000', created_at: '2024-01-02T00:00:00.000Z' },
        ];
        if (fn) fn(null, rows);
      }),
    };

    jest.mock('generic-pool', () => ({
      createPool: jest.fn(() => ({
        acquire: jest.fn().mockResolvedValue(mockConn),
        release: jest.fn(),
        drain: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
      })),
    }));

    ({ app } = require('./server'));
    request = require('supertest');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns 400 when neither address nor search is provided', async () => {
    const res = await request(app).get('/lookup');
    expect(res.status).toBe(400);
  });

  test('exact address lookup returns single record (backward compat)', async () => {
    const res = await request(app).get(`/lookup?address=${VALID_ADDRESS}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'alice*localhost', address: VALID_ADDRESS });
    expect(res.body).not.toHaveProperty('data');
  });

  test('search mode returns paginated metadata block', async () => {
    const res = await request(app).get('/lookup?search=alice&page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('totalCount');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('currentPage', 1);
  });

  test('search mode defaults page to 1 and limit to 10 when omitted', async () => {
    const res = await request(app).get('/lookup?search=alice');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentPage: 1 });
  });
});

describe('GET /users — pagination and search', () => {
  let request;
  let app;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('dotenv', () => ({ config: jest.fn() }));
    jest.mock('fs', () => ({ ...jest.requireActual('fs'), mkdirSync: jest.fn() }));
    jest.mock('@stellar/stellar-sdk', () => ({ Horizon: { Server: jest.fn() }, StrKey: { isValidEd25519PublicKey: jest.fn(() => true) } }));
    jest.mock('pdfkit', () => jest.fn());
    jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

    jest.mock('sqlite3', () => ({
      verbose: () => ({
        Database: jest.fn().mockImplementation((_path, cb) => {
          const db = { run: jest.fn((sql, cb2) => cb2 && cb2(null)), close: jest.fn((cb2) => cb2 && cb2()) };
          if (cb) cb(null);
          return db;
        }),
      }),
    }));

    const mockConn = {
      run: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        if (fn) fn.call({ lastID: 0, changes: 0 }, null);
      }),
      get: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        if (fn) fn(null, { total: 25 });
      }),
      all: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        const rows = Array.from({ length: 10 }, (_, i) => ({
          username: `user${i}*localhost`,
          address: `G${'A'.repeat(55)}${i}`,
          created_at: '2024-01-01T00:00:00.000Z',
        }));
        if (fn) fn(null, rows);
      }),
    };

    jest.mock('generic-pool', () => ({
      createPool: jest.fn(() => ({
        acquire: jest.fn().mockResolvedValue(mockConn),
        release: jest.fn(),
        drain: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
      })),
    }));

    ({ app } = require('./server'));
    request = require('supertest');
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
  let mockConn;

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

    jest.mock('sqlite3', () => ({
      verbose: () => ({
        Database: jest.fn().mockImplementation((_path, cb) => {
          const db = { run: jest.fn((sql, cb2) => cb2 && cb2(null)), close: jest.fn((cb2) => cb2 && cb2()) };
          if (cb) cb(null);
          return db;
        }),
      }),
    }));

    mockConn = {
      run: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        if (fn) fn.call({ lastID: 1, changes: 1 }, null);
      }),
      get: jest.fn((sql, params, cb) => {
        const fn = typeof params === 'function' ? params : cb;
        if (fn) fn(null, null);
      }),
    };

    jest.mock('generic-pool', () => ({
      createPool: jest.fn(() => ({
        acquire: jest.fn().mockResolvedValue(mockConn),
        release: jest.fn(),
        drain: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
      })),
    }));

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
});

