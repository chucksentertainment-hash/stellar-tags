import { useEffect, useState } from 'react';
import NetworkBadge from '../NetworkBadge';
import ScrollToTop from '../ScrollToTop';
import MobileNav from './MobileNav';
import {
  ANALYTICS_MAX_PAGES,
  ANALYTICS_PAGE_LIMIT,
  ANALYTICS_REFRESH_MS,
  ANALYTICS_WINDOW_MS,
  HORIZON_BASE,
  NAV_STORAGE_KEY,
  formatShortAddress,
  useNavState,
  useWalletMenu,
} from './shared';

function AnalyticsPage({
  userPublicKey,
  onConnectWallet,
  onDisconnectWallet,
  onDashboardClick,
  onHistoryClick,
  onHelpClick,
  onRegisterClick,
  canRegister,
}) {
  const [isNavOpen, setIsNavOpen] = useNavState();
  const [isConnecting, setIsConnecting] = useState(false);
  const [analyticsMetrics, setAnalyticsMetrics] = useState({
    routingVolume: null,
    avgConfirmation: null,
    successRate: null,
  });
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
      await onConnectWallet();
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    let isActive = true;
    let currentController = null;

    const fetchHorizon = async (url, signal) => {
      const response = await fetch(url, { signal, cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Horizon error (${response.status}).`);
      }

      return response.json();
    };

    const loadRoutingVolume = async (sinceMs, signal) => {
      let url = `${HORIZON_BASE}/payments?order=desc&limit=${ANALYTICS_PAGE_LIMIT}`;
      let pages = 0;
      let total = 0;

      while (url && pages < ANALYTICS_MAX_PAGES) {
        const data = await fetchHorizon(url, signal);
        const records = data?._embedded?.records ?? [];
        if (records.length === 0) {
          break;
        }

        let reachedWindowEnd = false;
        for (const record of records) {
          const createdAt = Date.parse(record.created_at);
          if (!Number.isFinite(createdAt) || createdAt < sinceMs) {
            reachedWindowEnd = true;
            break;
          }

          if (record.asset_type === "native" && record.amount) {
            total += Number(record.amount);
          }
        }

        if (reachedWindowEnd) {
          break;
        }

        url = data?._links?.next?.href;
        pages += 1;
      }

      return Number.isFinite(total) ? total : null;
    };

    const loadSuccessRate = async (sinceMs, signal) => {
      let url = `${HORIZON_BASE}/transactions?order=desc&limit=${ANALYTICS_PAGE_LIMIT}`;
      let pages = 0;
      let total = 0;
      let successCount = 0;

      while (url && pages < ANALYTICS_MAX_PAGES) {
        const data = await fetchHorizon(url, signal);
        const records = data?._embedded?.records ?? [];
        if (records.length === 0) {
          break;
        }

        let reachedWindowEnd = false;
        for (const record of records) {
          const createdAt = Date.parse(record.created_at);
          if (!Number.isFinite(createdAt) || createdAt < sinceMs) {
            reachedWindowEnd = true;
            break;
          }

          total += 1;
          if (record.successful) {
            successCount += 1;
          }
        }

        if (reachedWindowEnd) {
          break;
        }

        url = data?._links?.next?.href;
        pages += 1;
      }

      if (total === 0) {
        return null;
      }

      return (successCount / total) * 100;
    };

    const loadAvgConfirmation = async (sinceMs, signal) => {
      let url = `${HORIZON_BASE}/ledgers?order=desc&limit=${ANALYTICS_PAGE_LIMIT}`;
      let pages = 0;
      let previousClosedAt = null;
      let totalDelta = 0;
      let deltaCount = 0;

      while (url && pages < ANALYTICS_MAX_PAGES) {
        const data = await fetchHorizon(url, signal);
        const records = data?._embedded?.records ?? [];
        if (records.length === 0) {
          break;
        }

        let reachedWindowEnd = false;
        for (const record of records) {
          const closedAt = Date.parse(record.closed_at);
          if (!Number.isFinite(closedAt) || closedAt < sinceMs) {
            reachedWindowEnd = true;
            break;
          }

          if (previousClosedAt !== null) {
            const deltaSeconds = (previousClosedAt - closedAt) / 1000;
            if (deltaSeconds > 0) {
              totalDelta += deltaSeconds;
              deltaCount += 1;
            }
          }

          previousClosedAt = closedAt;
        }

        if (reachedWindowEnd) {
          break;
        }

        url = data?._links?.next?.href;
        pages += 1;
      }

      if (deltaCount === 0) {
        return null;
      }

      return totalDelta / deltaCount;
    };

    const loadMetrics = async () => {
      if (currentController) {
        currentController.abort();
      }

      const controller = new AbortController();
      currentController = controller;
      const sinceMs = Date.now() - ANALYTICS_WINDOW_MS;

      try {
        const [routingVolume, avgConfirmation, successRate] = await Promise.all(
          [
            loadRoutingVolume(sinceMs, controller.signal),
            loadAvgConfirmation(sinceMs, controller.signal),
            loadSuccessRate(sinceMs, controller.signal),
          ],
        );

        if (!isActive) {
          return;
        }

        setAnalyticsMetrics({
          routingVolume,
          avgConfirmation,
          successRate,
        });
      } catch (error) {
        if (!isActive || error.name === "AbortError") {
          return;
        }

        setAnalyticsMetrics({
          routingVolume: null,
          avgConfirmation: null,
          successRate: null,
        });
      } finally {
        if (currentController === controller) {
          currentController = null;
        }
      }
    };

    loadMetrics();
    const intervalId = setInterval(loadMetrics, ANALYTICS_REFRESH_MS);

    return () => {
      isActive = false;
      if (currentController) {
        currentController.abort();
      }
      clearInterval(intervalId);
    };
  }, []);

  const formatNumber = (value, options = {}) =>
    new Intl.NumberFormat("en-US", options).format(value);

  const fallbackValue = "--";
  const routingVolumeValue =
    analyticsMetrics.routingVolume === null
      ? fallbackValue
      : formatNumber(analyticsMetrics.routingVolume, {
          maximumFractionDigits: 2,
        });
  const avgConfirmationValue =
    analyticsMetrics.avgConfirmation === null
      ? fallbackValue
      : analyticsMetrics.avgConfirmation.toFixed(2);
  const successRateValue =
    analyticsMetrics.successRate === null
      ? fallbackValue
      : analyticsMetrics.successRate.toFixed(1);

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
          <button type="button" onClick={() => handleNav(onHistoryClick)}>
            History
          </button>
          <button type="button" aria-current="page" onClick={closeNav}>
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
          <h3>Signal</h3>
          <p>Routing data is refreshed every 15 minutes.</p>
        </div>
        <div className="sidebar-card">
          <h3>Exports</h3>
          <p>Download detailed reports from the analytics console.</p>
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
            <h2 className="headline">Insights & Integrity</h2>
            <p className="subtle">
              Verified proof of every route, settlement speed, and platform
              success.
            </p>
          </div>
          <div className="topbar-actions">
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
                  <button type="button" onClick={onDisconnectWallet}>
                    Disconnect wallet
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid columns-3">
          <div className="card reveal">
            <div className="card-header">
              <h2>Flow volume</h2>
              <span className="badge">Last 1h</span>
            </div>
            <div className="metric">
              {routingVolumeValue} <span>XLM</span>
            </div>
          </div>
          <div className="card reveal">
            <div className="card-header">
              <h2>Avg confirmation</h2>
              <span className="badge">Network</span>
            </div>
            <div className="metric">
              {avgConfirmationValue} <span>sec</span>
            </div>
          </div>
          <div className="card reveal">
            <div className="card-header">
              <h2>Routing reliability</h2>
              <span className="badge">Last 1h</span>
            </div>
            <div className="metric">
              {successRateValue} <span>percent</span>
            </div>
          </div>
        </section>
      </main>
      <MobileNav
        active="analytics"
        onDashboardClick={() => handleNav(onDashboardClick)}
        onHistoryClick={() => handleNav(onHistoryClick)}
        onAnalyticsClick={closeNav}
        onHelpClick={() => handleNav(onHelpClick)}
        onRegisterClick={() => handleNav(onRegisterClick)}
        canRegister={canRegister}
      />
      <ScrollToTop />
    </div>
  );
}

export default AnalyticsPage;
