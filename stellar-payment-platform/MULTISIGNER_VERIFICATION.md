# Multi-Signer Threshold Verification

## Overview

This module implements enterprise-grade multi-signer account verification for the Stellar Tags platform. It enables support for accounts using multiple signatories with threshold-based authorization, ensuring that registration requests meet the account's signing requirements as configured on the Stellar ledger.

## Key Concepts

### Signer Configuration
Each Stellar account has:
- **Master Key**: The primary account keypair with an adjustable weight
- **Additional Signers**: Other public keys authorized to sign on behalf of the account
- **Weights**: Numeric values assigned to each signer (0 = inactive, 1-255 = active weight)

### Thresholds
Stellar accounts define three independent signing thresholds:

| Threshold | Purpose | Use Case |
|-----------|---------|----------|
| **Low Threshold** | Payment operations | Standard transactions |
| **Med Threshold** | Management operations | Account modifications, signing requirement changes |
| **High Threshold** | High-security operations | Signer/threshold modifications |

For registration, we use the **management threshold** to ensure proper authorization for account setup.

### Signature Calculation
Total authorization weight is calculated by summing the weights of all provided signers:

$$\text{Total Weight} = \sum_{i=1}^{n} \text{weight}_i$$

Authorization succeeds when:

$$\text{Total Weight} \geq \text{Required Threshold}$$

## Implementation

### Core Module: `src/multisigner-verifier.js`

#### Main Function: `verifyMultiSignerThreshold()`

```javascript
async verifyMultiSignerThreshold(accountId, signaturePublicKeys, options)
```

**Parameters:**
- `accountId` (string): The Stellar account public key
- `signaturePublicKeys` (Array<string>): Public keys that have signed
- `options` (Object, optional):
  - `operationType` (string): 'payment' | 'management' | 'high' (default: 'payment')
  - `horizonUrl` (string): Custom Horizon API URL

**Returns:**
```javascript
{
  success: boolean,              // Whether threshold is met
  accountId: string,             // The account ID verified
  operationType: string,         // Operation type checked
  requiredThreshold: number,     // Minimum weight needed
  totalWeight: number,           // Total weight provided
  signatureCount: number,        // Number of unique signatures provided
  uniqueSignerCount: number,     // Number of valid signers
  signatures: Array<{            // Details for each signature
    publicKey: string,
    weight: number,
    isValid: boolean
  }>,
  thresholds: {                 // Account's thresholds
    low_threshold: number,
    med_threshold: number,
    high_threshold: number
  },
  signerCount: number,          // Total registered signers
  errorMessage: string | null   // Failure reason if applicable
}
```

### Integration with Registration

The `/register` endpoint now:

1. **Validates inputs** (username, address, signature format)
2. **Fetches account configuration** from Horizon network
3. **Calculates signature weights** against the account's signer configuration
4. **Verifies threshold requirements** for account management operations
5. **Records registration** only if verification succeeds

#### Request Example

```json
{
  "username": "enterprise-org",
  "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
  "signature": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z"
}
```

#### Success Response (201 Created)

```json
{
  "ok": true,
  "username": "enterprise-org",
  "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
  "federation_address": "enterprise-org*localhost",
  "verification": {
    "accountId": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
    "signerCount": 3,
    "thresholdMet": true,
    "requiredThreshold": 15,
    "providedWeight": 18
  }
}
```

#### Error Response (401 Unauthorized)

```json
{
  "error": "Signature verification failed: Insufficient signing weight. Required: 15, Provided: 8"
}
```

## Supported Account Types

### Single-Signer Accounts (Most Common)
- Only the master key is authorized
- Weight = 1, Threshold = 1
- Backward compatible with existing implementation

**Example:**
```
Signers: [
  { key: GDXYZ..., weight: 1, type: ed25519_public_key }
]
Thresholds: { low: 1, med: 1, high: 1 }
```

### Multi-Signer Accounts (Enterprise)
- Multiple authorized signers with different weights
- Flexible thresholds for different operation types
- More complex authorization patterns

**Example:**
```
Signers: [
  { key: GMASTER..., weight: 10, type: ed25519_public_key },
  { key: GSIGNER1..., weight: 5, type: ed25519_public_key },
  { key: GSIGNER2..., weight: 5, type: ed25519_public_key }
]
Thresholds: { low: 5, med: 15, high: 20 }
```

In this case:
- Any single signer with weight ≥ 5 can authorize payments
- At least 15 combined weight needed for management operations
- At least 20 weight for high-security operations

## Error Handling

### Network Errors
- **Account Not Found (404)**: Account doesn't exist on Horizon
- **Network Timeout**: Horizon API unreachable
- **Invalid Account ID**: Malformed public key

### Verification Errors
- **Insufficient Weight**: Total signature weight < required threshold
- **Invalid Signature**: Public key not registered as signer
- **Empty Signatures**: No signatures provided for verification

### Database Errors
- **Address Already Registered (409)**: Account already has a username tag
- **Username Already Registered (409)**: Username already taken
- **Database Connection Error (500)**: SQLite connection failure

## Usage Examples

### Single-Signer Account Registration

```javascript
const result = await verifyMultiSignerThreshold(
  'GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z',
  ['GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z'],
  { operationType: 'management' }
);

// Result:
// {
//   success: true,
//   requiredThreshold: 1,
//   totalWeight: 1,
//   errorMessage: null
// }
```

### Multi-Signer Account with Insufficient Weight

```javascript
const result = await verifyMultiSignerThreshold(
  'GMASTER...',
  ['GSIGNER1...'],  // Only one weak signer
  { operationType: 'management' }
);

// Result:
// {
//   success: false,
//   requiredThreshold: 15,
//   totalWeight: 5,
//   errorMessage: 'Insufficient signing weight. Required: 15, Provided: 5'
// }
```

### Multi-Signer Account with Sufficient Weight

```javascript
const result = await verifyMultiSignerThreshold(
  'GMASTER...',
  [
    'GMASTER...',   // weight: 10
    'GSIGNER1...'   // weight: 5
  ],
  { operationType: 'management' }
);

// Result:
// {
//   success: true,
//   requiredThreshold: 15,
//   totalWeight: 15,
//   signatures: [
//     { publicKey: 'GMASTER...', weight: 10, isValid: true },
//     { publicKey: 'GSIGNER1...', weight: 5, isValid: true }
//   ]
// }
```

## Testing

### Unit Tests

Run signature verification tests:

```bash
npm test -- multisigner-verifier.test.js
```

Tests cover:
- Single and multi-signer verification
- Threshold calculations
- Weight aggregation
- Error handling
- Signature deduplication

### Integration Tests

Run registration endpoint tests:

```bash
npm test -- register-multisigner.test.js
```

Tests cover:
- Single-signer registration
- Multi-signer registration
- Threshold validation
- Error responses
- Response metadata
- Username normalization
- Address conflict detection

### End-to-End Testing

Test against testnet:

```bash
# Set Horizon URL to testnet
export HORIZON_BASE=https://horizon-testnet.stellar.org

# Run server
npm start

# Test registration
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
    "signature": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z"
  }'
```

## Performance Considerations

### Network Calls
- One API call to Horizon per registration (`server.loadAccount()`)
- Minimal payload: account details only
- Cached on Horizon side (5-10 second TTL typical)

### Weight Calculation
- $O(n \times m)$ complexity where:
  - n = number of provided signatures
  - m = number of registered signers
- Typical: 1-10 signatures, 1-10 signers = negligible overhead

### Database Operations
- Standard SQL queries with prepared statements
- UNIQUE constraints on address and username
- Indexed lookups on both fields

## Security Considerations

### Signature Verification
- ✅ All signatures fetched directly from authoritative Horizon API
- ✅ Weights and thresholds immutable on ledger
- ✅ No local verification of signatures (relies on Stellar's ledger state)

### Input Validation
- ✅ Public key format validation (StrKey checks)
- ✅ Empty input rejection
- ✅ Duplicate removal for signature aggregation
- ✅ String trimming to prevent whitespace bypasses

### Attack Mitigation
- ✅ SQL injection prevention via prepared statements
- ✅ Rate limiting via HTTP layer (configured separately)
- ✅ Payload size limit (10 KB JSON) prevents DoS
- ✅ Horizon API queries are idempotent

## Migration Guide

### For Existing Single-Signer Accounts

No changes required. The system is **fully backward compatible**:
- Existing registrations continue to work
- Single-signer verification passes automatically
- No database migration needed

### For New Enterprise Accounts

1. **Configure Multi-Signers on Ledger**
   ```javascript
   // Set up signers via Stellar SDK
   account.setSigner(signer2PublicKey, 5);
   account.setSigner(signer3PublicKey, 5);
   ```

2. **Set Thresholds**
   ```javascript
   account.setThreshold('low', 5);    // Any single signer
   account.setThreshold('med', 15);   // Most signers combined
   account.setThreshold('high', 20);  // All signers combined
   ```

3. **Register on Stellar Tags**
   ```bash
   curl -X POST http://localhost:5000/register \
     -H "Content-Type: application/json" \
     -d '{
       "username": "enterprise-org",
       "address": "GMASTER...",
       "signature": "GMASTER..."  # Primary signer
     }'
   ```

## Future Enhancements

1. **Multiple Signature Submission**
   - Accept array of signatures in single request
   - Validate combined weight in one call

2. **Threshold Caching**
   - Cache account configuration in Redis
   - Reduce Horizon API calls for repeated registrations

3. **Webhook Notifications**
   - Alert on registration with multi-signer verification
   - Audit trail for compliance

4. **Admin Endpoints**
   - Re-verify existing registrations
   - Update verification status on ledger changes

## References

- [Stellar Documentation: Multi-Sig Transactions](https://developers.stellar.org/docs/glossary/multisig)
- [Stellar SDK: Account Signers](https://js.stellar.org/api/Account.html)
- [Horizon API: Load Account](https://developers.stellar.org/api/introduction/pagination/)
