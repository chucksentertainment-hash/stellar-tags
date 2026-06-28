/**
 * Multi-Signer Verification Module
 * Handles threshold signature validation for enterprise accounts with multiple signers
 * 
 * Fetches account details from Horizon network and validates that provided signatures
 * meet the minimum threshold requirements based on ledger configuration.
 */

const { Horizon } = require('@stellar/stellar-sdk');

const HORIZON_BASE = process.env.HORIZON_BASE || 'https://horizon-testnet.stellar.org';

/**
 * Fetches account details from Horizon network including signer configuration
 * @param {string} accountId - The Stellar account public key
 * @param {string} horizonUrl - Optional custom Horizon URL
 * @returns {Promise<Object>} Account object with signers array and thresholds
 * @throws {Error} If account not found or network error
 */
async function fetchAccountSigners(accountId, horizonUrl = HORIZON_BASE) {
  try {
    const server = new Horizon.Server(horizonUrl);
    const account = await server.loadAccount(accountId);
    
    return {
      accountId: account.id,
      signers: account.signers,
      thresholds: {
        low_threshold: account.thresholds.low_threshold,
        med_threshold: account.thresholds.med_threshold,
        high_threshold: account.thresholds.high_threshold,
      },
      sequence: account.sequence,
      balances: account.balances,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Account not found on Horizon: ${accountId}`);
    }
    throw new Error(`Failed to fetch account signers: ${error.message}`);
  }
}

/**
 * Calculates total signature weight from provided public keys
 * @param {Array<string>} signaturePublicKeys - Array of signer public keys
 * @param {Array<Object>} accountSigners - Account signers from Horizon (signers array)
 * @returns {Object} { totalWeight: number, signatureDetails: Array }
 */
function calculateSignatureWeight(signaturePublicKeys, accountSigners) {
  const signatureDetails = [];
  let totalWeight = 0;

  // Build a map of public key -> weight from account signers
  const signerMap = new Map();
  for (const signer of accountSigners) {
    signerMap.set(signer.key, signer.weight);
  }

  // Calculate weight for each provided signature
  for (const pubKey of signaturePublicKeys) {
    const weight = signerMap.get(pubKey) || 0;
    signatureDetails.push({
      publicKey: pubKey,
      weight: weight,
      isValid: weight > 0,
    });
    if (weight > 0) {
      totalWeight += weight;
    }
  }

  return {
    totalWeight,
    signatureDetails,
  };
}

/**
 * Determines which threshold should be applied based on operation type
 * Uses: low_threshold (payment), med_threshold (management), high_threshold (highest security)
 * @param {string} operationType - Type of operation: 'payment', 'management', or 'high'
 * @param {Object} thresholds - Thresholds object { low_threshold, med_threshold, high_threshold }
 * @returns {number} The appropriate threshold value
 */
function getApplicableThreshold(operationType = 'payment', thresholds) {
  switch (operationType) {
    case 'management':
      return thresholds.med_threshold;
    case 'high':
      return thresholds.high_threshold;
    case 'payment':
    default:
      return thresholds.low_threshold;
  }
}

/**
 * Verifies that provided signatures meet the account's signing requirements
 * @param {string} accountId - The Stellar account public key
 * @param {Array<string>} signaturePublicKeys - Array of public keys that signed
 * @param {Object} options - Verification options
 * @param {string} options.operationType - Type of operation ('payment', 'management', 'high')
 * @param {string} options.horizonUrl - Custom Horizon URL
 * @returns {Promise<Object>} Verification result with details
 * @throws {Error} If verification fails
 */
async function verifyMultiSignerThreshold(accountId, signaturePublicKeys = [], options = {}) {
  const {
    operationType = 'payment',
    horizonUrl = HORIZON_BASE,
  } = options;

  // Validate inputs
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Invalid account ID provided');
  }

  if (!Array.isArray(signaturePublicKeys) || signaturePublicKeys.length === 0) {
    throw new Error('At least one signature is required for verification');
  }

  // Remove duplicates
  const uniqueSignatures = [...new Set(signaturePublicKeys)];

  try {
    // Fetch account details from Horizon
    const accountDetails = await fetchAccountSigners(accountId, horizonUrl);
    
    // Determine applicable threshold based on operation type
    const requiredThreshold = getApplicableThreshold(operationType, accountDetails.thresholds);

    // Calculate total weight from provided signatures
    const { totalWeight, signatureDetails } = calculateSignatureWeight(
      uniqueSignatures,
      accountDetails.signers
    );

    // Check if weight meets threshold
    const meetsThreshold = totalWeight >= requiredThreshold;

    return {
      success: meetsThreshold,
      accountId,
      operationType,
      requiredThreshold,
      totalWeight,
      signatureCount: uniqueSignatures.length,
      uniqueSignerCount: signatureDetails.filter(s => s.isValid).length,
      signatures: signatureDetails,
      thresholds: accountDetails.thresholds,
      signerCount: accountDetails.signers.length,
      errorMessage: meetsThreshold ? null : 
        `Insufficient signing weight. Required: ${requiredThreshold}, Provided: ${totalWeight}`,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Checks if account is single-signer (only master key with weight 1)
 * @param {Array<Object>} signers - Account signers array from Horizon
 * @returns {boolean} True if account has only master signer with weight 1
 */
function isSingleSignerAccount(signers) {
  if (!Array.isArray(signers) || signers.length !== 1) {
    return false;
  }
  
  const masterSigner = signers[0];
  return masterSigner.signer_type === 'ed25519_public_key' && masterSigner.weight === 1;
}

/**
 * Validates that signature matches account's master key
 * For single-signer accounts, this provides backward compatibility
 * @param {string} accountId - The account public key
 * @param {string} signaturePublicKey - The signature to verify
 * @param {string} horizonUrl - Custom Horizon URL
 * @returns {Promise<boolean>} True if signature matches account's master key
 */
async function verifyMasterSignature(accountId, signaturePublicKey, horizonUrl = HORIZON_BASE) {
  try {
    if (accountId === signaturePublicKey) {
      return true;
    }

    // Check if account has this signer registered
    const accountDetails = await fetchAccountSigners(accountId, horizonUrl);
    const signerExists = accountDetails.signers.some(s => s.key === signaturePublicKey);
    
    return signerExists;
  } catch (error) {
    return false;
  }
}

module.exports = {
  fetchAccountSigners,
  calculateSignatureWeight,
  getApplicableThreshold,
  verifyMultiSignerThreshold,
  isSingleSignerAccount,
  verifyMasterSignature,
};
