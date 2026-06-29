const request = require('supertest');
const { prisma } = require('../prismaClient');

// Mock the Stellar SDK to prevent Jest ESM syntax errors
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn(() => true) }
}));

// Mock Prisma so it doesn't try to connect to a real database and crash
jest.mock('../prismaClient', () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  }
}));

const { app } = require('../server');

describe('Global HTTP Response Compression Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Large Payload (> 1KB threshold)', () => {
    beforeEach(() => {
      // Mock 50 users to make the JSON payload exceed 1KB
      const mockUsers = Array.from({ length: 50 }, (_, i) => ({
        username: `user${i}`,
        address: `GDQA27V4NZPUIQNZPUIQNZPUIQNZPUIQNZPUIQNZPUIQNZPUIQNZPUIQ${i}`,
        createdAt: new Date('2026-06-29T12:00:00Z'),
      }));
      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.user.count.mockResolvedValue(50);
    });

    it('should compress with gzip when Accept-Encoding: gzip is sent', async () => {
      const res = await request(app)
        .get('/users')
        .set('Accept-Encoding', 'gzip');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
    });

    it('should compress with br (Brotli) when Accept-Encoding: br is sent', async () => {
      const res = await request(app)
        .get('/users')
        .set('Accept-Encoding', 'br');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
    });

    it('should prioritize br (Brotli) over gzip if both are supported', async () => {
      const res = await request(app)
        .get('/users')
        .set('Accept-Encoding', 'br, gzip');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
    });

    it('should not compress if Accept-Encoding is not sent or does not match supported methods', async () => {
      const res = await request(app)
        .get('/users')
        .set('Accept-Encoding', 'identity');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
    });
  });

  describe('Small Payload (< 1KB threshold)', () => {
    beforeEach(() => {
      // Mock 1 user to make the JSON payload under 1KB
      const mockUsers = [{
        username: 'user',
        address: 'GDQA27V4NZPUIQNZPUIQNZPUIQNZPUIQNZPUIQNZPUIQNZPUIQNZPUIQ',
        createdAt: new Date('2026-06-29T12:00:00Z'),
      }];
      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.user.count.mockResolvedValue(1);
    });

    it('should not compress even if Accept-Encoding: gzip is sent', async () => {
      const res = await request(app)
        .get('/users')
        .set('Accept-Encoding', 'gzip');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
    });
  });
});
