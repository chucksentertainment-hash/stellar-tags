import { Fragment, useCallback, useEffect, useState } from 'react';
import NetworkBadge from '../NetworkBadge';
import ScrollToTop from '../ScrollToTop';
import MobileNav from './MobileNav';
import { HORIZON_BASE, NAV_STORAGE_KEY, formatShortAddress, useNavState, useWalletMenu } from './shared';

function HistoryPage({
  userPublicKey,
  setUserPublicKey,
  onConnectWallet,
  onDisconnectWallet,
  onRefreshBalance,
  onDashboardClick,
  onAnalyticsClick,
  onHelpClick,
  onRegisterClick,
  canRegister,
}) {
  const [isNavOpen, setIsNavOpen] = useNavState();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const {
    menuRef,
    isOpen: isWalletMenuOpen,
    setIsOpen: setIsWalletMenuOpen,
  } = useWalletMenu();
  const closeNav = () => {
    sessionStorage.setItem(NAV_STORAGE_KEY, "false");
    setIsNavOpen(false);
  };
  const handleNav = (action) => {
    sessionStorage.setItem(NAV_STORAGE_KEY, "false");
    setIsNavOpen(false);
    action();
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await onConnectWallet();
      if (result?.address) {
        setUserPublicKey(result.address);
      }
    } finally {
      setIsConnecting(false);
    }
  };
  const handleDisconnect = () => {
    onDisconnectWallet();
  };

  const loadHistory = useCallback(
    async (signal) => {
      if (!userPublicKey) {
        return;
      }

      await Promise.resolve();
      setIsLoading(true);
      setHistoryError("");
      try {
        const response = await fetch(
          `${HORIZON_BASE}/accounts/${userPublicKey}/payments?order=desc&limit=25`,
          { signal, cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`Horizon error (${response.status}).`);
        }

        const data = await response.json();
        const records = data?._embedded?.records ?? [];
        const filtered = records.filter((record) =>
          [
            "payment",
            "path_payment_strict_receive",
            "path_payment_strict_send",
            "create_account",
            "account_merge",
            "invoke_host_function",
          ].includes(record.type),
        );
        const formatted = filtered
          .flatMap((record) => {
            if (
              record.type === "invoke_host_function" &&
              record.asset_balance_changes?.length
            ) {
              const changes = record.asset_balance_changes
                .filter((change) => change.asset_type === "native")
                .filter(
                  (change) =>
                    change.from === userPublicKey ||
                    change.to === userPublicKey,
                );

              return changes.map((change, index) => {
                const direction =
                  change.from === userPublicKey ? "Sent" : "Received";
                const counterparty =
                  change.from === userPublicKey ? change.to : change.from;
                const amount = `${change.amount} XLM`;
                const status =
                  record.transaction_successful === false
                    ? "Failed"
                    : "Success";
                const explorerLink = record.transaction_hash
                  ? `https://stellar.expert/explorer/testnet/tx/${record.transaction_hash}`
                  : "";

                return {
                  id: `${record.id}-${index}`,
                  counterparty: counterparty || "Unknown",
                  direction,
                  amount,
                  status,
                  type: record.type,
                  createdAt: record.created_at,
                  transactionHash: record.transaction_hash,
                  asset: "XLM",
                  explorerLink,
                };
              });
            }

            const isSender =
              record.from === userPublicKey || record.account === userPublicKey;
            const isReceiver =
              record.to === userPublicKey || record.into === userPublicKey;
            const direction =
              isSender && !isReceiver
                ? "Sent"
                : isReceiver
                  ? "Received"
                  : "Sent";
            const counterparty =
              direction === "Sent"
                ? record.to || record.into || record.account || "Unknown"
                : record.from || record.funder || record.account || "Unknown";

            const asset =
              record.asset_type === "native"
                ? "XLM"
                : record.asset_code || "Asset";
            const rawAmount = record.amount || record.starting_balance || "";
            const amount = rawAmount ? `${rawAmount} ${asset}` : "-";
            const status =
              record.transaction_successful === false ? "Failed" : "Success";
            const explorerLink = record.transaction_hash
              ? `https://stellar.expert/explorer/testnet/tx/${record.transaction_hash}`
              : "";

            return [
              {
                id: String(record.id),
                counterparty,
                direction,
                amount,
                status,
                type: record.type,
                createdAt: record.created_at,
                transactionHash: record.transaction_hash,
                asset,
                explorerLink,
              },
            ];
          })
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const latest = formatted[0];
        if (latest?.status === "Success") {
          const lastSeen = sessionStorage.getItem("stellar-last-tx");
          const latestKey = `${latest.transactionHash || latest.id}-${latest.amount}`;
          if (latestKey !== lastSeen) {
            sessionStorage.setItem("stellar-last-tx", latestKey);
            onRefreshBalance();
          }
        }

        setHistory(formatted);
      } catch (error) {
        if (error.name !== "AbortError") {
          setHistoryError(
            error.message || "Unable to load transaction history.",
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [onRefreshBalance, userPublicKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      await loadHistory(controller.signal);
    };
    run();
    return () => controller.abort();
  }, [loadHistory, refreshIndex, userPublicKey]);

  useEffect(() => {
    const handleUpdate = () => {
      setRefreshIndex((value) => value + 1);
    };

    window.addEventListener("stellar:tx-update", handleUpdate);
    return () => window.removeEventListener("stellar:tx-update", handleUpdate);
  }, []);
  return (
    <div className={`dashboard ${isNavOpen ? "nav-open" : ""}`}>
      <button
        type="button"
        className={`sidebar-scrim ${isNavOpen ? "is-open" : ""}`}
        onClick={() => setIsNavOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${isNavOpen ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <h1>Stellar Pay</h1>
        </div>
        <div className="nav">
          <button type="button" onClick={() => handleNav(onDashboardClick)}>
            Dashboard
          </button>
          <button type="button" aria-current="page" onClick={closeNav}>
            History
          </button>
          <button type="button" onClick={() => handleNav(onAnalyticsClick)}>
            Analytics
          </button>
          <button type="button" onClick={() => handleNav(onHelpClick)}>
            Help
          </button>
          {canRegister && (
            <button type="button" onClick={() => handleNav(onRegisterClick)}>
              Registration
            </button>
          )}
        </div>
        <div className="sidebar-card">
          <h3>Timeline</h3>
          <p>Payments are archived for 90 days.</p>
        </div>
        <div className="sidebar-card">
          <h3>Filters</h3>
          <p>Sort by status, amount, or corridor.</p>
        </div>
        {userPublicKey && (
          <button
            type="button"
            className="disconnect-button"
            onClick={onDisconnectWallet}
          >
            Disconnect wallet
          </button>
        )}
      </aside>

      <main className="main">
        <section className="topbar reveal">
          <button
            type="button"
            className="hamburger"
            onClick={() => setIsNavOpen((prev) => !prev)}
            aria-label="Toggle navigation"
            aria-expanded={isNavOpen}
          >
            <span />
            <span />
            <span />
          </button>
          <div>
            <h2 className="headline">Transaction history</h2>
            <p className="subtle">
              Connect your wallet to review recent transactions.
            </p>
          </div>
          <div className="topbar-actions">
            <span className="chip">Last 24 hours</span>
            <NetworkBadge />
            <div className="wallet-menu" ref={menuRef}>
              <button
                type="button"
                className="connect-pill"
                onClick={() => {
                  if (userPublicKey) {
                    setIsWalletMenuOpen((prev) => !prev);
                  } else {
                    handleConnect();
                  }
                }}
                disabled={isConnecting}
                aria-expanded={isWalletMenuOpen}
              >
                {userPublicKey
                  ? `Connected: ${formatShortAddress(userPublicKey)}`
                  : isConnecting
                    ? "Connecting..."
                    : "Connect wallet"}
              </button>
              {userPublicKey && isWalletMenuOpen && (
                <div className="wallet-dropdown">
                  <button type="button" onClick={handleDisconnect}>
                    Disconnect wallet
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="card reveal">
          <div className="card-header">
            <h2>Recent transactions</h2>
            <div className="history-actions">
              <span className="chip">Latest</span>
              <button
                type="button"
                className={`refresh-button ${isLoading ? "is-loading" : ""}`}
                onClick={() => setRefreshIndex((value) => value + 1)}
                disabled={!userPublicKey || isLoading}
                aria-label="Refresh history"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                  <path d="M20 4v6h-6" />
                </svg>
              </button>
            </div>
          </div>
          {!userPublicKey && (
            <div className="wallet-status">
              Connect your wallet to view your transaction history.
              <button
                type="button"
                onClick={handleConnect}
                disabled={isConnecting}
              >
                {isConnecting ? "Connecting..." : "Connect wallet"}
              </button>
            </div>
          )}
          {userPublicKey && isLoading && (
            <div className="wallet-status">Loading transactions...</div>
          )}
          {userPublicKey && historyError && (
            <div className="wallet-status">{historyError}</div>
          )}
          {userPublicKey &&
            !isLoading &&
            !historyError &&
            history.length === 0 && (
              <div className="wallet-status">
                No transactions found for this wallet.
              </div>
            )}
          {userPublicKey &&
            !isLoading &&
            !historyError &&
            history.length > 0 && (
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Counterparty</th>
                    <th>Direction</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr>
                        <td>{formatShortAddress(entry.counterparty)}</td>
                        <td>{entry.direction}</td>
                        <td>{entry.amount}</td>
                        <td>{entry.status}</td>
                        <td>
                          <button
                            type="button"
                            className="details-button"
                            onClick={() =>
                              setExpandedId((current) =>
                                current === entry.id ? null : entry.id,
                              )
                            }
                          >
                            {expandedId === entry.id ? "Hide" : "View"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === entry.id && (
                        <tr className="details-row">
                          <td colSpan={5}>
                            <div className="details-panel">
                              <div>
                                <strong>Type:</strong> {entry.type}
                              </div>
                              <div>
                                <strong>Counterparty:</strong>{" "}
                                {entry.counterparty}
                              </div>
                              <div>
                                <strong>Asset:</strong> {entry.asset}
                              </div>
                              <div>
                                <strong>Time:</strong>{" "}
                                {new Date(entry.createdAt).toLocaleString()}
                              </div>
                              <div>
                                <strong>Hash:</strong>{" "}
                                {entry.transactionHash || "Unavailable"}
                              </div>
                              {entry.explorerLink && (
                                <div>
                                  <a
                                    className="details-link"
                                    href={entry.explorerLink}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View on Stellar Expert
                                  </a>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
        </section>
      </main>
      <MobileNav
        active="history"
        onDashboardClick={() => handleNav(onDashboardClick)}
        onHistoryClick={closeNav}
        onAnalyticsClick={() => handleNav(onAnalyticsClick)}
        onHelpClick={() => handleNav(onHelpClick)}
        onRegisterClick={() => handleNav(onRegisterClick)}
        canRegister={canRegister}
      />
      <ScrollToTop />
    </div>
  );
}

export default HistoryPage;
