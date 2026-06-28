# Deployment Checklist

## Pre-Deployment Verification

### Code Review Checklist
- [ ] All tests pass: `npm test`
- [ ] No linting errors: `npm run lint` (if configured)
- [ ] Code review completed and approved
- [ ] No console.log statements left (except errors)
- [ ] Error messages are user-friendly
- [ ] All edge cases handled

### Test Coverage Verification
- [ ] Unit tests pass: `npm test -- multisigner-verifier.test.js`
- [ ] Integration tests pass: `npm test -- register-multisigner.test.js`
- [ ] Test coverage > 90% for new modules
- [ ] Manual testing completed on testnet

### Documentation Review
- [ ] MULTISIGNER_VERIFICATION.md is complete
- [ ] FLOW_DIAGRAM.md covers all scenarios
- [ ] IMPLEMENTATION_SUMMARY.md is accurate
- [ ] MULTISIGNER_README.md is user-friendly
- [ ] All code has JSDoc comments
- [ ] Error messages are documented

### Security Review
- [ ] No hardcoded credentials
- [ ] All SQL uses prepared statements ✅
- [ ] Input validation on all endpoints ✅
- [ ] Error handling doesn't leak sensitive info ✅
- [ ] Rate limiting configured (if needed)
- [ ] HTTPS enforced in production

### Compatibility Review
- [ ] Backward compatible with existing registrations ✅
- [ ] No database schema changes
- [ ] No breaking API changes
- [ ] Existing clients still work
- [ ] Federation lookups unchanged

## Staging Deployment

### Pre-Staging Setup
- [ ] Create staging database backup
- [ ] Set HORIZON_BASE=https://horizon-testnet.stellar.org
- [ ] Create test accounts on testnet
- [ ] Document test account credentials

### Staging Deployment Steps
1. [ ] Deploy code to staging server
2. [ ] Run database migrations (if any): `npm run migrate`
3. [ ] Verify environment variables are set correctly
4. [ ] Start server: `npm start`
5. [ ] Check logs for errors: `tail -f logs/server.log`

### Staging Testing
1. [ ] Test single-signer registration
   ```bash
   curl -X POST http://staging:5000/register \
     -H "Content-Type: application/json" \
     -d '{
       "username": "test-single",
       "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z",
       "signature": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z"
     }'
   ```

2. [ ] Test error: missing signature
   ```bash
   curl -X POST http://staging:5000/register \
     -H "Content-Type: application/json" \
     -d '{
       "username": "test-no-sig",
       "address": "GDZST3XVCDTUJ76ZAV2HA72KYQM3DGLLFVDNNZ6XTQCR3BQFGMQ25E4Z"
     }'
   ```

3. [ ] Test error: insufficient weight (multi-signer)
4. [ ] Test error: account not found
5. [ ] Test error: duplicate address
6. [ ] Test federation lookup still works
7. [ ] Test receipts endpoint still works
8. [ ] Verify existing registrations still accessible
9. [ ] Check response times acceptable (<500ms typical)
10. [ ] Monitor error logs for issues

### Staging Validation
- [ ] All tests passed
- [ ] No new errors in logs
- [ ] Response times acceptable
- [ ] Database connections stable
- [ ] Horizon API calls successful
- [ ] Error handling works correctly

## Production Deployment

### Production Pre-Deployment
- [ ] Backup production database
- [ ] Document rollback procedure
- [ ] Notify team of deployment window
- [ ] Create change log entry
- [ ] Schedule post-deployment verification

### Production Deployment Steps
1. [ ] Set maintenance mode (optional)
2. [ ] Deploy code to production
3. [ ] Run database migrations (if any)
4. [ ] Verify environment variables
5. [ ] Start server: `npm start`
6. [ ] Monitor logs for first 30 minutes
7. [ ] Exit maintenance mode

### Production Verification
- [ ] Check server health endpoint
- [ ] Verify registration works: test account registration
- [ ] Check database connectivity
- [ ] Verify Horizon API connectivity
- [ ] Monitor error rates (<1% expected)
- [ ] Test each endpoint manually:
  - [ ] POST /register
  - [ ] GET /federation
  - [ ] GET /lookup
  - [ ] GET /api/v1/receipts/:txHash

### Post-Deployment Monitoring (24 hours)
- [ ] Monitor error logs: `tail -f logs/server.log | grep ERROR`
- [ ] Check registration success rate
- [ ] Monitor response times
- [ ] Verify no increase in failed transactions
- [ ] Check CPU/memory usage normal
- [ ] Verify backup jobs still run

## Rollback Procedure

If critical issues occur:

1. [ ] Stop server: `npm stop` or `kill <PID>`
2. [ ] Restore database backup: `sqlite3 registrations.db < backup.sql`
3. [ ] Revert code to previous version: `git checkout <previous-tag>`
4. [ ] Restart server: `npm start`
5. [ ] Verify service is back online
6. [ ] Investigate root cause
7. [ ] Document incident

## Documentation Updates

- [ ] Update API documentation with new signature field
- [ ] Update integration guides
- [ ] Update troubleshooting guide
- [ ] Update release notes with:
  - [ ] New features
  - [ ] Breaking changes (none)
  - [ ] Deprecations (none)
  - [ ] Performance improvements
  - [ ] Bug fixes

## Team Communication

- [ ] Notify frontend team of API changes
- [ ] Notify clients of new verification requirements
- [ ] Update status page if applicable
- [ ] Send deployment notification email
- [ ] Schedule post-deployment review

## Success Criteria

✅ All criteria must be met before considering deployment successful:

1. [ ] Zero critical errors in logs
2. [ ] All tests passing (unit + integration)
3. [ ] Response time < 500ms (99th percentile)
4. [ ] Error rate < 1%
5. [ ] Existing registrations work unchanged
6. [ ] New multi-signer registrations work
7. [ ] Federation lookups unchanged
8. [ ] No database connection issues
9. [ ] Horizon API calls successful
10. [ ] Staff verified registration manually

## Sign-Off

- [ ] Developer: _________________ Date: _______
- [ ] QA/Tester: ________________ Date: _______
- [ ] DevOps/Operations: _________ Date: _______
- [ ] Tech Lead: ________________ Date: _______

## Issues Found During Deployment

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| | | | |

## Deployment Summary

**Deployment Date**: _______________
**Deployment Time**: _______________
**Duration**: _______________
**Downtime**: _______________
**Issues**: _______________
**Status**: [ ] Success  [ ] Partial  [ ] Rollback

**Notes**:
