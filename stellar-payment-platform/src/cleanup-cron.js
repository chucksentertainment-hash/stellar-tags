const cron = require('node-cron');
const { promisify } = require('util');

/**
 * Number of days after which a registration is considered stale.
 * Accounts older than this threshold and not matching any active network
 * address will be removed; those that do match will be flagged instead.
 */
const STALE_THRESHOLD_DAYS = 90;

/**
 * A set of "active" Stellar network addresses that should never be fully
 * removed.  In a real deployment this would be populated dynamically (e.g.
 * by querying Horizon), but a hard-coded set is sufficient for testnet
 * hygiene purposes.
 */
const ACTIVE_NETWORK_ADDRESSES = new Set([
  'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ',
]);

/**
 * Runs the stale-account cleanup logic against the provided sqlite3 database
 * instance.  The function is exported separately so it can be unit-tested
 * without needing a live cron scheduler.
 *
 * Behaviour:
 *   - Registrations older than STALE_THRESHOLD_DAYS whose address is NOT in
 *     ACTIVE_NETWORK_ADDRESSES are permanently deleted.
 *   - Registrations older than STALE_THRESHOLD_DAYS whose address IS in
 *     ACTIVE_NETWORK_ADDRESSES are flagged by setting flagged_at to the
 *     current timestamp (the column is added lazily if it does not yet exist).
 *
 * @param {import('sqlite3').Database} db - An open sqlite3 database instance.
 * @returns {Promise<{pruned: number, flagged: number}>}
 */
function runCleanup(db) {
  const runAsync = typeof db.runAsync === 'function'
    ? db.runAsync.bind(db)
    : promisify(db.run.bind(db));

  const getAsync = typeof db.getAsync === 'function'
    ? db.getAsync.bind(db)
    : promisify(db.get.bind(db));

  return (async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS);
    const cutoffIso = cutoff.toISOString();

    // Ensure the flagged_at column exists (idempotent migration).
    try {
      await runAsync(
        `ALTER TABLE username_registry ADD COLUMN flagged_at TEXT`,
      );
    } catch (_err) {
      // Ignore errors – the column likely already exists.
    }

    // 1. Delete stale rows that are NOT active network addresses.
    await runAsync(
      `DELETE FROM username_registry
       WHERE created_at < ?
         AND address NOT IN (${[...ACTIVE_NETWORK_ADDRESSES].map(() => '?').join(',')})`,
      [cutoffIso, ...ACTIVE_NETWORK_ADDRESSES],
    );
    const pruneResult = await getAsync('SELECT changes() AS changes');
    const pruned = pruneResult?.changes || 0;

    // 2. Flag stale rows that ARE active network addresses.
    await runAsync(
      `UPDATE username_registry
       SET flagged_at = ?
       WHERE created_at < ?
         AND address IN (${[...ACTIVE_NETWORK_ADDRESSES].map(() => '?').join(',')})
         AND flagged_at IS NULL`,
      [new Date().toISOString(), cutoffIso, ...ACTIVE_NETWORK_ADDRESSES],
    );
    const flagResult = await getAsync('SELECT changes() AS changes');

    return { pruned, flagged: flagResult?.changes || 0 };
  })();
}

/**
 * Registers a weekly cron job (every Sunday at midnight) that calls
 * `runCleanup` and logs the results.
 *
 * @param {import('sqlite3').Database} db - An open sqlite3 database instance.
 */
function scheduleCleanupJob(db) {
  // Cron expression: "0 0 * * 0" → runs at 00:00 every Sunday.
  cron.schedule('0 0 * * 0', async () => {
    console.log('[cleanup-cron] Starting stale-account sweep…');
    try {
      const { pruned, flagged } = await runCleanup(db);
      console.log(
        `[cleanup-cron] Sweep complete – pruned: ${pruned}, flagged: ${flagged}`,
      );
    } catch (err) {
      console.error('[cleanup-cron] Sweep failed:', err.message);
    }
  });

  console.log('[cleanup-cron] Weekly cleanup job scheduled (Sundays at midnight).');
}

module.exports = { scheduleCleanupJob, runCleanup, STALE_THRESHOLD_DAYS };
