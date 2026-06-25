'use strict';

const request = require('supertest');

// Mutable closures that each test overrides in beforeEach / per-test
let mockTxImpl;
let mockPaymentsImpl;

jest.mock('@stellar/stellar-sdk', () => {
  const Server = jest.fn().mockImplementation(() => ({
    transactions: () => ({ transaction: () => ({ call: () => mockTxImpl() }) }),
    payments: () => ({ forTransaction: () => ({ call: () => mockPaymentsImpl() }) }),
  }));
  return { Horizon: { Server } };
});

jest.mock('pdfkit', () => {
  const { Readable } = require('stream');
  return jest.fn().mockImplementation(() => {
    const doc = new Readable({ read() {} });
    doc.fontSize = jest.fn().mockReturnThis();
    doc.text = jest.fn().mockReturnThis();
    doc.moveDown = jest.fn().mockReturnThis();
    doc.fillColor = jest.fn().mockReturnThis();
    doc.end = jest.fn(() => {
      doc.push(Buffer.from('%PDF-1.4 mock'));
      doc.push(null);
    });
    return doc;
  });
});

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

// The receipts endpoint never touches the database, but loading server.js does
// instantiate the Prisma client — mock it so no real connection is created.
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

const VALID_HASH = 'a'.repeat(64);

const TX_RESULT = {
  created_at: '2024-01-15T10:30:00Z',
  source_account: 'GSENDER000000000000000000000000000000000000000000000000',
};

const PAYMENT_RESULT = {
  records: [
    {
      asset_type: 'native',
      from: 'GSENDER000000000000000000000000000000000000000000000000',
      to: 'GRECEIVER0000000000000000000000000000000000000000000000',
      amount: '10.0000000',
    },
  ],
};

beforeEach(() => {
  mockTxImpl = () => Promise.resolve(TX_RESULT);
  mockPaymentsImpl = () => Promise.resolve(PAYMENT_RESULT);
});

describe('GET /api/v1/receipts/:txHash', () => {
  test('valid hash returns a PDF with correct headers', async () => {
    const res = await request(app).get(`/api/v1/receipts/${VALID_HASH}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment;\s*filename="receipt-[a-f0-9]{64}\.pdf"/,
    );
    expect(res.body.length || Buffer.byteLength(res.text)).toBeGreaterThan(0);
  });

  test('invalid hash format returns 400', async () => {
    const res = await request(app).get('/api/v1/receipts/not-a-real-hash');

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid transaction hash format');
  });

  test('hash with invalid chars returns 400', async () => {
    const res = await request(app).get(`/api/v1/receipts/${'z'.repeat(64)}`);

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid transaction hash format');
  });

  test('nonexistent hash returns 404', async () => {
    mockTxImpl = () => Promise.reject({ response: { status: 404 } });

    const res = await request(app).get(`/api/v1/receipts/${VALID_HASH}`);

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('Transaction not found');
  });

  test('SDK network failure returns 500', async () => {
    mockTxImpl = () => Promise.reject(new Error('Network timeout'));

    const res = await request(app).get(`/api/v1/receipts/${VALID_HASH}`);

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe('Failed to fetch transaction');
  });

  test('Soroban tx with no native payment op falls back gracefully', async () => {
    mockPaymentsImpl = () => Promise.resolve({ records: [] });

    const res = await request(app).get(`/api/v1/receipts/${VALID_HASH}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });
});
