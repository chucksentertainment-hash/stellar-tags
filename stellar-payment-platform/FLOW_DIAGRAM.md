# Multi-Signer Verification Flow

## Registration Flow Diagram

```
POST /register
    ↓
┌─────────────────────────────────────┐
│ 1. Validate Inputs                  │
│ - username present & non-empty      │
│ - address is valid Ed25519 key      │
│ - signature present & non-empty     │
└─────────────────────────────────────┘
    ↓ (Success)
┌─────────────────────────────────────┐
│ 2. Check Address Uniqueness         │
│ - Query: SELECT FROM registry       │
│   WHERE address = ?                 │
└─────────────────────────────────────┘
    ↓ (Not found = OK)
┌─────────────────────────────────────┐
│ 3. Fetch Account from Horizon       │
│ - Call: server.loadAccount(address) │
│ - Get: signers[], thresholds        │
└─────────────────────────────────────┘
    ↓ (Success)
┌─────────────────────────────────────┐
│ 4. Determine Threshold              │
│ - operationType = 'management'      │
│ - Return: med_threshold value       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 5. Calculate Weight                 │
│ - Build signer map: key → weight    │
│ - Sum weight for each signature     │
│ - Result: totalWeight               │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 6. Verify Threshold                 │
│ - Compare: totalWeight              │
│   >= requiredThreshold?             │
└─────────────────────────────────────┘
    ↓ (Success)
┌─────────────────────────────────────┐
│ 7. Insert Registration              │
│ - INSERT INTO registry              │
│   (username, address, created_at)   │
└─────────────────────────────────────┘
    ↓
201 Created Response
{
  "ok": true,
  "verification": {
    "accountId": "...",
    "thresholdMet": true,
    ...
  }
}

ERROR PATHS:
├─ Invalid input → 400 Bad Request
├─ Address exists → 409 Conflict
├─ Account not found → 404 Not Found
├─ Signature verification failed → 401 Unauthorized
└─ Database error → 500 Server Error
```

## Weight Calculation Algorithm

```
FUNCTION calculateWeight(signatures[], signers[]):
  // Build map: public_key → weight
  signerMap = {}
  FOR EACH signer IN signers:
    signerMap[signer.key] = signer.weight
  
  // Calculate total weight
  totalWeight = 0
  signatureDetails = []
  
  FOR EACH signature IN signatures:
    weight = signerMap[signature] ?? 0
    signatureDetails.push({
      publicKey: signature,
      weight: weight,
      isValid: weight > 0
    })
    IF weight > 0:
      totalWeight += weight
  
  RETURN {
    totalWeight: totalWeight,
    signatureDetails: signatureDetails
  }
END
```

## Threshold Verification Algorithm

```
FUNCTION verifyThreshold(account, signatures[], operationType):
  // Fetch from Horizon
  thresholds = account.thresholds
  signers = account.signers
  
  // Get required threshold
  SWITCH operationType:
    CASE 'payment':
      requiredThreshold = thresholds.low_threshold
    CASE 'management':
      requiredThreshold = thresholds.med_threshold
    CASE 'high':
      requiredThreshold = thresholds.high_threshold
    DEFAULT:
      requiredThreshold = thresholds.low_threshold
  
  // Calculate weight
  { totalWeight, signatureDetails } = calculateWeight(signatures, signers)
  
  // Verify
  success = totalWeight >= requiredThreshold
  
  RETURN {
    success: success,
    totalWeight: totalWeight,
    requiredThreshold: requiredThreshold,
    errorMessage: success ? null : "Insufficient weight..."
  }
END
```

## Data Structures

### Account Object (from Horizon)
```javascript
{
  id: string,                    // Account public key
  signers: [
    {
      key: string,               // Signer's public key
      weight: number,            // 0-255
      signer_type: string        // 'ed25519_public_key'
    }
  ],
  thresholds: {
    low_threshold: number,       // Payment operations
    med_threshold: number,       // Management operations
    high_threshold: number       // High-security operations
  },
  sequence: string,              // Current sequence number
  balances: [...]               // Account balances
}
```

### Verification Result
```javascript
{
  success: boolean,
  accountId: string,
  operationType: string,
  requiredThreshold: number,
  totalWeight: number,
  signatureCount: number,
  uniqueSignerCount: number,
  signatures: [
    {
      publicKey: string,
      weight: number,
      isValid: boolean
    }
  ],
  thresholds: {
    low_threshold: number,
    med_threshold: number,
    high_threshold: number
  },
  signerCount: number,
  errorMessage: string | null
}
```

## Example Scenarios

### Scenario 1: Single-Signer Account
```
Account State:
├─ Master Key: GMASTER... (weight: 1)
└─ Thresholds: low=1, med=1, high=1

Registration Request:
├─ Address: GMASTER...
└─ Signature: GMASTER...

Verification:
├─ Required Threshold (med): 1
├─ Provided Weight: 1
├─ Result: ✓ SUCCESS

Response: 201 Created
```

### Scenario 2: Multi-Signer - Insufficient Weight
```
Account State:
├─ Master Key: GMASTER... (weight: 8)
├─ Signer 2: GSIGNER1... (weight: 5)
├─ Signer 3: GSIGNER2... (weight: 5)
└─ Thresholds: low=5, med=15, high=20

Registration Request:
├─ Address: GMASTER...
└─ Signature: GSIGNER1...  (only 5 weight)

Verification:
├─ Required Threshold (med): 15
├─ Provided Weight: 5
├─ Result: ✗ FAILED

Response: 401 Unauthorized
Error: "Insufficient signing weight. Required: 15, Provided: 5"
```

### Scenario 3: Multi-Signer - Sufficient Weight
```
Account State:
├─ Master Key: GMASTER... (weight: 8)
├─ Signer 2: GSIGNER1... (weight: 5)
├─ Signer 3: GSIGNER2... (weight: 5)
└─ Thresholds: low=5, med=15, high=20

Registration Request:
├─ Address: GMASTER...
└─ Signatures: [GMASTER..., GSIGNER1...]

Verification:
├─ Required Threshold (med): 15
├─ Weight Calculation:
│  ├─ GMASTER...: 8
│  └─ GSIGNER1...: 5
├─ Provided Weight: 13... wait, need one more signer
└─ Let's try: [GMASTER..., GSIGNER1..., GSIGNER2...]
   ├─ Weight: 8 + 5 + 5 = 18
   └─ Result: ✓ SUCCESS (18 >= 15)

Response: 201 Created
verification.providedWeight: 18
```

### Scenario 4: Account Not Found
```
Registration Request:
├─ Address: GINVALID... (doesn't exist on Horizon)
└─ Signature: GINVALID...

Verification:
├─ Horizon API Call: FAILED
├─ Error: 404 Not Found
└─ Result: ✗ FAILED

Response: 404 Not Found
Error: "Account not found on Horizon: GINVALID..."
```

## Error Decision Tree

```
Registration Request
├─ Missing Fields?
│  └─ YES → 400 Bad Request
├─ Invalid Key Format?
│  └─ YES → 400 Bad Request
├─ Address Already Registered?
│  └─ YES → 409 Conflict
├─ Account Exists on Horizon?
│  ├─ NO → 404 Not Found
│  └─ YES → Continue
├─ Signature Weight >= Threshold?
│  ├─ NO → 401 Unauthorized
│  └─ YES → Continue
├─ Username Already Taken?
│  └─ YES → 409 Conflict
├─ Database Insert Failed?
│  └─ YES → 500 Server Error
└─ SUCCESS → 201 Created
```

## Testing Strategies

### Unit Test Coverage
1. **Positive Cases**
   - Single signer with sufficient weight
   - Multiple signers with sufficient combined weight
   - Different operation types (low/med/high threshold)

2. **Negative Cases**
   - Insufficient weight
   - Invalid/unregistered signer
   - Account not found
   - Network errors

3. **Edge Cases**
   - Duplicate signatures (should deduplicate)
   - Empty signature array
   - Invalid account ID format
   - Zero-weight signers

### Integration Test Coverage
1. **Request Validation**
   - Missing fields
   - Invalid format
   - Nested objects (should reject)

2. **Response Validation**
   - HTTP status codes correct
   - Response body contains verification metadata
   - Federation address format correct

3. **Database Interactions**
   - Address uniqueness enforced
   - Username uniqueness enforced
   - Correct insertion of registration

### Manual Test Commands

```bash
# Single-signer success
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
    "signature": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z"
  }'

# Multi-signer insufficient weight
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "bob",
    "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
    "signature": "GCMYSPHFP3L5SDIYBHWHQJVAKQQQC47PGP4TQMJUFAXTVXLKBF3KYQCF"
  }'

# Missing signature
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "charlie",
    "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z"
  }'
```
