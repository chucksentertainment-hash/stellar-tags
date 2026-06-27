import { useState } from 'react';
import ScrollToTop from '../ScrollToTop';
import MobileNav from './MobileNav';
import { NAV_STORAGE_KEY, useNavState } from './shared';

function HelpPage({
  userPublicKey,
  onDisconnectWallet,
  onDashboardClick,
  onAnalyticsClick,
  onHistoryClick,
  onRegisterClick,
  canRegister,
}) {
  const [isNavOpen, setIsNavOpen] = useNavState();
  const [activeHelpAction, setActiveHelpAction] = useState("");
  const closeNav = () => {
    sessionStorage.setItem(NAV_STORAGE_KEY, "false");
    setIsNavOpen(false);
  };
  const handleNav = (action) => {
    sessionStorage.setItem(NAV_STORAGE_KEY, "false");
    setIsNavOpen(false);
    action();
  };

  const helpContent = {
    identity: (
      <div className="help-action-content">
        <p>
          Our platform uses a Federation Server. This acts as a decentralized
          phonebook that maps your easy-to-read name tag directly to your
          cryptographic public key.
        </p>
        <div className="help-action-block">
          <strong>The Process:</strong>
          <ol>
            <li>Navigate to the Profile page.</li>
            <li>Connect your Freighter Wallet to verify ownership.</li>
            <li>Enter your desired username and click Claim.</li>
          </ol>
        </div>
        <p className="help-action-note">
          Note: Once claimed, your name tag is permanent and can be shared with
          anyone on the network to receive instant payments.
        </p>
      </div>
    ),
    troubleshooting: (
      <div className="help-action-content">
        <p>
          <strong>Simulation Failed:</strong> If the dashboard says "Simulation
          Failed," it usually means the smart contract rejected the logic.
          Ensure you aren't trying to send more XLM than you actually have in
          your balance (including the 0.4% fee, capped at 30 XLM).
        </p>
        <p>
          <strong>Wallet Locked:</strong> If the Freighter popup doesn't appear,
          check the extension icon in your browser. If it has a red dot or says
          "Locked," you must re-enter your password before the dashboard can
          request a signature.
        </p>
      </div>
    ),
  };
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
          <button type="button" onClick={() => handleNav(onAnalyticsClick)}>
            Analytics
          </button>
          <button type="button" aria-current="page" onClick={closeNav}>
            Help
          </button>
          {canRegister && (
            <button type="button" onClick={() => handleNav(onRegisterClick)}>
              Registration
            </button>
          )}
        </div>
        <div className="sidebar-card">
          <h3>Support hours</h3>
          <p>Live help is active Mon-Fri, 09:00-18:00 UTC.</p>
        </div>
        <div className="sidebar-card">
          <h3>Contact</h3>
          <p>Need a real person? Open a ticket from your wallet settings.</p>
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
        <section className="help-hero">
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
          <div className="help-hero-content">
            <p className="help-eyebrow">Help Center</p>
            <h2 className="help-title">System Clarity</h2>
            <div className="help-search" role="search">
              <input
                type="search"
                placeholder="Search identities, routing, or transactions"
                aria-label="Search the help center"
              />
              <div className="help-search-glow" aria-hidden="true" />
            </div>
            <div className="help-actions">
              <button
                type="button"
                className={activeHelpAction === "identity" ? "is-active" : ""}
                onClick={() =>
                  setActiveHelpAction((prev) =>
                    prev === "identity" ? "" : "identity",
                  )
                }
              >
                Claim Identity
              </button>
              <button type="button">Smart Routing</button>
              <button
                type="button"
                className={
                  activeHelpAction === "troubleshooting" ? "is-active" : ""
                }
                onClick={() =>
                  setActiveHelpAction((prev) =>
                    prev === "troubleshooting" ? "" : "troubleshooting",
                  )
                }
              >
                Troubleshooting
              </button>
            </div>
            <div
              className={`help-action-panel ${activeHelpAction ? "is-visible" : ""}`}
              aria-live="polite"
            >
              {helpContent[activeHelpAction] ?? null}
            </div>
            <div className="help-status">
              <span className="status-dot" aria-hidden="true" />
              Stellar Testnet: Operational
            </div>
          </div>
        </section>
      </main>
      <MobileNav
        active="help"
        onDashboardClick={() => handleNav(onDashboardClick)}
        onHistoryClick={() => handleNav(onHistoryClick)}
        onAnalyticsClick={() => handleNav(onAnalyticsClick)}
        onHelpClick={closeNav}
        onRegisterClick={() => handleNav(onRegisterClick)}
        canRegister={canRegister}
      />
      <ScrollToTop />
    </div>
  );
}

export default HelpPage;
