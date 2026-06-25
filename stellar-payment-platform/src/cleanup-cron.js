const cron = require('node-cron');

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
 * Runs the stale-account cleanup logic against the provided Prisma client.
 * The function is exported separately so it can be unit-tested without needing
 * a live cron scheduler.
 *
 * Behaviour:
 *   - Registrations older than STALE_THRESHOLD_DAYS whose address is NOT in
 *     ACTIVE_NETWORK_ADDRESSES are permanently deleted.
 *   - Registrations older than STALE_THRESHOLD_DAYS whose address IS in
 *     ACTIVE_NETWORK_ADDRESSES are flagged by setting flaggedAt to the
 *     current timestamp (only if not already flagged).
 *
 * @param {import('@prisma/client').PrismaClient} prisma - A Prisma client.
 * @returns {Promise<{pruned: number, flagged: number}>}
 */
async function runCleanup(prisma) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS);

  const activeAddresses = [...ACTIVE_NETWORK_ADDRESSES];

  // 1. Delete stale rows that are NOT active network addresses.
  const pruneResult = await prisma.user.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      address: { notIn: activeAddresses },
    },
  });

  // 2. Flag stale rows that ARE active network addresses.
  const flagResult = await prisma.user.updateMany({
    where: {
      createdAt: { lt: cutoff },
      address: { in: activeAddresses },
      flaggedAt: null,
    },
    data: { flaggedAt: new Date() },
  });

  return { pruned: pruneResult.count, flagged: flagResult.count };
}

/**
 * Registers a weekly cron job (every Sunday at midnight) that calls
 * `runCleanup` and logs the results.
 *
 * @param {import('@prisma/client').PrismaClient} prisma - A Prisma client.
 */
function scheduleCleanupJob(prisma) {
  // Cron expression: "0 0 * * 0" → runs at 00:00 every Sunday.
  cron.schedule('0 0 * * 0', async () => {
    console.log('[cleanup-cron] Starting stale-account sweep…');
    try {
      const { pruned, flagged } = await runCleanup(prisma);
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
