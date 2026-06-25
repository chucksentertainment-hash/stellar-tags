// ---------------------------------------------------------------------------
// #52 — SSE Horizon Listener for Real-Time Payment Detection
// ---------------------------------------------------------------------------
// This background service connects to the Stellar Horizon network using
// Server-Sent Events (SSE) to monitor incoming payments for all public keys
// registered in the local federation database.
//
// Usage:
//   npm run listener                  (testnet, default)
//   HORIZON_NETWORK=public npm run listener  (mainnet)
// ---------------------------------------------------------------------------

const { Horizon } = require('@stellar/stellar-sdk');
const { prisma } = require('./prismaClient');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const NETWORK = process.env.HORIZON_NETWORK || 'testnet';

const HORIZON_URLS = {
  testnet: 'https://horizon-testnet.stellar.org',
  public: 'https://horizon.stellar.org',
};

const HORIZON_URL = HORIZON_URLS[NETWORK] || HORIZON_URLS.testnet;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS, 10) || 60000; // Re-check for new accounts every 60s

// ---------------------------------------------------------------------------
// Horizon Server Instance
// ---------------------------------------------------------------------------
const horizon = new Horizon.Server(HORIZON_URL);

// Track active streams so we can clean up on shutdown
const activeStreams = new Map();

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------
const timestamp = () => new Date().toISOString();

const formatPayment = (payment, trackedAccount) => {
  const direction = payment.to === trackedAccount ? 'INCOMING' : 'OUTGOING';
  const asset =
    payment.asset_type === 'native'
      ? 'XLM'
      : `${payment.asset_code}:${payment.asset_issuer}`;

  return [
    `[${timestamp()}] 💸 ${direction} PAYMENT DETECTED`,
    `  Account:     ${trackedAccount}`,
    `  From:        ${payment.from}`,
    `  To:          ${payment.to}`,
    `  Amount:      ${payment.amount} ${asset}`,
    `  Tx Hash:     ${payment.transaction_hash}`,
    `  Created:     ${payment.created_at}`,
    '  ─────────────────────────────────────────',
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Stream Management
// ---------------------------------------------------------------------------

/**
 * Open a payment SSE stream for a single Stellar account.
 * Returns the stream close function.
 */
const watchAccount = (accountId) => {
  if (activeStreams.has(accountId)) {
    return; // Already watching
  }

  console.log(`[${timestamp()}] 👁️  Watching payments for ${accountId}`);

  const closeStream = horizon
    .payments()
    .forAccount(accountId)
    .cursor('now')
    .stream({
      onmessage: (payment) => {
        // Only log payment operations (ignore account_merge, etc.)
        if (payment.type === 'payment' || payment.type_i === 1) {
          console.log(formatPayment(payment, accountId));
        }
      },
      onerror: (error) => {
        console.error(
          `[${timestamp()}] ⚠️  Stream error for ${accountId}:`,
          error?.message || error,
        );
        // The SDK handles automatic reconnection for SSE streams
      },
    });

  activeStreams.set(accountId, closeStream);
};

/**
 * Query the local database for all registered public keys and open
 * streams for any that aren't already being watched.
 */
const syncWatchedAccounts = async () => {
  try {
    const rows = await prisma.user.findMany({
      distinct: ['address'],
      select: { address: true },
    });

    const currentAddresses = new Set(rows.map((r) => r.address));

    // Start watching new accounts
    for (const { address } of rows) {
      if (!activeStreams.has(address)) {
        watchAccount(address);
      }
    }

    // Stop watching removed accounts
    for (const [address, closeFn] of activeStreams) {
      if (!currentAddresses.has(address)) {
        console.log(`[${timestamp()}] 🛑 Stopped watching removed account ${address}`);
        if (typeof closeFn === 'function') closeFn();
        activeStreams.delete(address);
      }
    }

    console.log(
      `[${timestamp()}] 📡 Actively monitoring ${activeStreams.size} account(s)`,
    );
  } catch (err) {
    console.error(`[${timestamp()}] ❌ Failed to sync watched accounts:`, err.message);
  }
};

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------
const shutdown = async () => {
  console.log(`\n[${timestamp()}] Shutting down Horizon listener...`);
  for (const [address, closeFn] of activeStreams) {
    if (typeof closeFn === 'function') closeFn();
    console.log(`  Closed stream for ${address}`);
  }
  activeStreams.clear();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Stellar Horizon Payment Listener');
  console.log(`  Network:  ${NETWORK.toUpperCase()}`);
  console.log(`  Horizon:  ${HORIZON_URL}`);
  console.log(`  Poll:     every ${POLL_INTERVAL_MS / 1000}s for new accounts`);
  console.log('═══════════════════════════════════════════════════════');

  // Initial sync
  await syncWatchedAccounts();

  // Periodically check for newly registered accounts
  setInterval(syncWatchedAccounts, POLL_INTERVAL_MS);
};

main().catch((err) => {
  console.error('Fatal error starting Horizon listener:', err);
  process.exit(1);
});
