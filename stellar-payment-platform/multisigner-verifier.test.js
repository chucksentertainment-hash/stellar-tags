/**
 * Multi-Signer Verification Tests
 * 
 * Tests cover:
 * - Single-signer account verification (backward compatible)
 * - Multi-signer enterprise account verification
 * - Threshold calculations and weight validation
 * - Error handling for missing accounts
 * - Signature validation against ledger configuration
 */

'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('@stellar/stellar-sdk', () => {
  const Horizon = {
    Server: jest.fn(),
  };
  
  return { Horizon };
});

const { Horizon } = require('@stellar/stellar-sdk');
const {
  fetchAccountSigners,
  calculateSignatureWeight,
  getApplicableThreshold,
  verifyMultiSignerThreshold,
  isSingleSignerAccount,
  verifyMasterSignature,
} = require('./src/multisigner-verifier');

describe('Multi-Signer Verification Module', () => {
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock server
    mockServer = {
      loadAccount: jest.fn(),
    };
    
    Horizon.Server.mockImplementation(() => mockServer);
  });

  describe('fetchAccountSigners', () => {
    it('should fetch account with signers from Horizon', async () => {
      const mockAccount = {
        id: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
        signers: [
          { key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z', weight: 1, signer_type: 'ed25519_public_key' }
        ],
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
        sequence: '123456789',
        balances: [{ balance: '100.0000000', asset_type: 'native' }],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const result = await fetchAccountSigners(mockAccount.id);

      expect(Horizon.Server).toHaveBeenCalledWith('https://horizon-testnet.stellar.org');
      expect(mockServer.loadAccount).toHaveBeenCalledWith(mockAccount.id);
      expect(result).toEqual({
        accountId: mockAccount.id,
        signers: mockAccount.signers,
        thresholds: mockAccount.thresholds,
        sequence: mockAccount.sequence,
        balances: mockAccount.balances,
      });
    });

    it('should throw error when account not found', async () => {
      const error = new Error('Not found');
      error.response = { status: 404 };
      mockServer.loadAccount.mockRejectedValue(error);

      const accountId = 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z';

      await expect(fetchAccountSigners(accountId)).rejects.toThrow(
        `Account not found on Horizon: ${accountId}`
      );
    });

    it('should throw error on network failure', async () => {
      mockServer.loadAccount.mockRejectedValue(new Error('Network error'));

      await expect(fetchAccountSigners('INVALID')).rejects.toThrow(
        'Failed to fetch account signers: Network error'
      );
    });

    it('should use custom Horizon URL when provided', async () => {
      mockServer.loadAccount.mockResolvedValue({
        id: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
        signers: [],
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        sequence: '0',
        balances: [],
      });

      const customUrl = 'https://horizon.stellar.org';
      await fetchAccountSigners('GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z', customUrl);

      expect(Horizon.Server).toHaveBeenCalledWith(customUrl);
    });
  });

  describe('calculateSignatureWeight', () => {
    it('should calculate weight for single signer', () => {
      const signatures = ['GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z'];
      const signers = [
        { key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z', weight: 1 }
      ];

      const result = calculateSignatureWeight(signatures, signers);

      expect(result.totalWeight).toBe(1);
      expect(result.signatureDetails).toEqual([
        {
          publicKey: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
          weight: 1,
          isValid: true,
        }
      ]);
    });

    it('should calculate weight for multiple signers', () => {
      const signatures = [
        'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
        'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF'
      ];
      const signers = [
        { key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z', weight: 5 },
        { key: 'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF', weight: 10 }
      ];

      const result = calculateSignatureWeight(signatures, signers);

      expect(result.totalWeight).toBe(15);
      expect(result.signatureDetails.length).toBe(2);
      expect(result.signatureDetails[0].weight).toBe(5);
      expect(result.signatureDetails[1].weight).toBe(10);
    });

    it('should mark invalid signers with zero weight', () => {
      const signatures = [
        'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
        'INVALIDKEY'
      ];
      const signers = [
        { key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z', weight: 5 }
      ];

      const result = calculateSignatureWeight(signatures, signers);

      expect(result.totalWeight).toBe(5);
      expect(result.signatureDetails[1].weight).toBe(0);
      expect(result.signatureDetails[1].isValid).toBe(false);
    });
  });

  describe('getApplicableThreshold', () => {
    const thresholds = {
      low_threshold: 1,
      med_threshold: 2,
      high_threshold: 3,
    };

    it('should return low threshold for payment operations', () => {
      expect(getApplicableThreshold('payment', thresholds)).toBe(1);
    });

    it('should return med threshold for management operations', () => {
      expect(getApplicableThreshold('management', thresholds)).toBe(2);
    });

    it('should return high threshold for high security operations', () => {
      expect(getApplicableThreshold('high', thresholds)).toBe(3);
    });

    it('should default to low threshold for unknown operation type', () => {
      expect(getApplicableThreshold('unknown', thresholds)).toBe(1);
    });
  });

  describe('verifyMultiSignerThreshold', () => {
    const accountId = 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z';

    it('should verify single-signer account with sufficient weight', async () => {
      const mockAccount = {
        id: accountId,
        signers: [
          { key: accountId, weight: 1, signer_type: 'ed25519_public_key' }
        ],
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
        sequence: '123456789',
        balances: [],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const result = await verifyMultiSignerThreshold(accountId, [accountId]);

      expect(result.success).toBe(true);
      expect(result.totalWeight).toBe(1);
      expect(result.requiredThreshold).toBe(1);
      expect(result.signerCount).toBe(1);
      expect(result.errorMessage).toBe(null);
    });

    it('should reject signature with insufficient weight', async () => {
      const signer2 = 'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF';
      const mockAccount = {
        id: accountId,
        signers: [
          { key: accountId, weight: 5, signer_type: 'ed25519_public_key' },
          { key: signer2, weight: 1, signer_type: 'ed25519_public_key' }
        ],
        thresholds: { low_threshold: 10, med_threshold: 15, high_threshold: 20 },
        sequence: '123456789',
        balances: [],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const result = await verifyMultiSignerThreshold(
        accountId,
        [signer2],
        { operationType: 'payment' }
      );

      expect(result.success).toBe(false);
      expect(result.totalWeight).toBe(1);
      expect(result.requiredThreshold).toBe(10);
      expect(result.errorMessage).toContain('Insufficient signing weight');
    });

    it('should verify multi-signer threshold for management operations', async () => {
      const signer2 = 'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF';
      const mockAccount = {
        id: accountId,
        signers: [
          { key: accountId, weight: 8, signer_type: 'ed25519_public_key' },
          { key: signer2, weight: 7, signer_type: 'ed25519_public_key' }
        ],
        thresholds: { low_threshold: 5, med_threshold: 10, high_threshold: 15 },
        sequence: '123456789',
        balances: [],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const result = await verifyMultiSignerThreshold(
        accountId,
        [accountId, signer2],
        { operationType: 'management' }
      );

      expect(result.success).toBe(true);
      expect(result.totalWeight).toBe(15);
      expect(result.requiredThreshold).toBe(10);
      expect(result.operationType).toBe('management');
    });

    it('should throw error for invalid account ID', async () => {
      await expect(verifyMultiSignerThreshold(null, ['GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z']))
        .rejects.toThrow('Invalid account ID provided');
    });

    it('should throw error for empty signature array', async () => {
      await expect(verifyMultiSignerThreshold(accountId, []))
        .rejects.toThrow('At least one signature is required for verification');
    });

    it('should deduplicate signatures in verification', async () => {
      const mockAccount = {
        id: accountId,
        signers: [
          { key: accountId, weight: 2, signer_type: 'ed25519_public_key' }
        ],
        thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
        sequence: '123456789',
        balances: [],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      // Pass same signature twice
      const result = await verifyMultiSignerThreshold(accountId, [accountId, accountId]);

      expect(result.success).toBe(true);
      expect(result.signatureCount).toBe(1); // Deduplicated
      expect(result.totalWeight).toBe(2);
    });
  });

  describe('isSingleSignerAccount', () => {
    it('should return true for single-signer account with weight 1', () => {
      const signers = [
        { 
          key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
          weight: 1,
          signer_type: 'ed25519_public_key'
        }
      ];

      expect(isSingleSignerAccount(signers)).toBe(true);
    });

    it('should return false for account with multiple signers', () => {
      const signers = [
        { key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z', weight: 1 },
        { key: 'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF', weight: 1 }
      ];

      expect(isSingleSignerAccount(signers)).toBe(false);
    });

    it('should return false for single signer with weight > 1', () => {
      const signers = [
        { 
          key: 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
          weight: 2,
          signer_type: 'ed25519_public_key'
        }
      ];

      expect(isSingleSignerAccount(signers)).toBe(false);
    });

    it('should return false for empty signers array', () => {
      expect(isSingleSignerAccount([])).toBe(false);
    });

    it('should return false for null input', () => {
      expect(isSingleSignerAccount(null)).toBe(false);
    });
  });

  describe('verifyMasterSignature', () => {
    const accountId = 'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z';

    it('should return true if signature matches account ID', async () => {
      const result = await verifyMasterSignature(accountId, accountId);
      expect(result).toBe(true);
    });

    it('should return true if signature is registered signer', async () => {
      const signer2 = 'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF';
      const mockAccount = {
        id: accountId,
        signers: [
          { key: accountId, weight: 1 },
          { key: signer2, weight: 1 }
        ],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        sequence: '123456789',
        balances: [],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const result = await verifyMasterSignature(accountId, signer2);
      expect(result).toBe(true);
    });

    it('should return false if signature is not registered', async () => {
      const mockAccount = {
        id: accountId,
        signers: [{ key: accountId, weight: 1 }],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        sequence: '123456789',
        balances: [],
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const result = await verifyMasterSignature(
        accountId,
        'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF'
      );
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockServer.loadAccount.mockRejectedValue(new Error('Network error'));

      const result = await verifyMasterSignature(
        accountId,
        'GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF'
      );
      expect(result).toBe(false);
    });
  });
});
