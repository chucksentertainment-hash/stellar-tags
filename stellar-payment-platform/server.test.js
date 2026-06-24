'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
}));

jest.mock('sqlite3', () => ({
  verbose: () => ({
    Database: jest.fn().mockImplementation((_path, cb) => {
      const db = {
        run: jest.fn(function (...args) {
          const fn = args.find((a) => typeof a === 'function');
          if (fn) fn.call({ lastID: 0, changes: 0 }, null);
        }),
        close: jest.fn((cb) => cb && cb()),
      };
      if (cb) cb(null);
      return db;
    }),
  }),
}));

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
