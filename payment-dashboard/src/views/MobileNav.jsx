function MobileNav({
  active,
  onDashboardClick,
  onHistoryClick,
  onAnalyticsClick,
  onHelpClick,
  onRegisterClick,
  canRegister,
}) {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      <button
        type="button"
        className={active === "dashboard" ? "is-active" : ""}
        onClick={onDashboardClick}
        aria-current={active === "dashboard" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
        <span>Dashboard</span>
      </button>
      <button
        type="button"
        className={active === "history" ? "is-active" : ""}
        onClick={onHistoryClick}
        aria-current={active === "history" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16M6 12h12M9 19h6" />
        </svg>
        <span>History</span>
      </button>
      <button
        type="button"
        className={active === "analytics" ? "is-active" : ""}
        onClick={onAnalyticsClick}
        aria-current={active === "analytics" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m5 14V9m5 10v-6m5 6V7" />
        </svg>
        <span>Analytics</span>
      </button>
      <button
        type="button"
        className={active === "help" ? "is-active" : ""}
        onClick={onHelpClick}
        aria-current={active === "help" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 18h.01M9.5 9.5a2.5 2.5 0 1 1 4.2 1.9c-.78.7-1.2 1.2-1.2 2.1" />
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        <span>Help</span>
      </button>
      {canRegister && (
        <button
          type="button"
          className={active === "register" ? "is-active" : ""}
          onClick={onRegisterClick}
          aria-current={active === "register" ? "page" : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
            <path d="M5 21a7 7 0 0 1 14 0" />
          </svg>
          <span>Register</span>
        </button>
      )}
    </nav>
  );
}

export default MobileNav;
