import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import freighterApi from '@stellar/freighter-api';
import LoadingSpinner from './components/LoadingSpinner';
import { HORIZON_BASE } from './views/shared';

const Dashboard = lazy(() => import('./views/Dashboard.jsx'));
const HelpPage = lazy(() => import('./views/HelpPage.jsx'));
const AnalyticsPage = lazy(() => import('./views/AnalyticsPage.jsx'));
const HistoryPage = lazy(() => import('./views/HistoryPage.jsx'));
const RegistrationPage = lazy(() => import('./views/RegistrationPage.jsx'));

function ViewFallback({ label = 'Loading view...' }) {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <LoadingSpinner color="text-blue" />
      <span>{label}</span>
    </div>
  );
}

function App() {
const [activeView, setActiveView] = useState('dashboard')
  const [userPublicKey, setUserPublicKey] = useState(() => {
    return localStorage.getItem('walletPublicKey') || ''
  })
  const [registrationState, setRegistrationState] = useState("unknown");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleConnectWallet = async () => {
    const status = await freighterApi.isConnected();
    const isInstalled =
      status.isConnected !== undefined ? status.isConnected : status;

    if (!isInstalled) {
      return { ok: false, error: "Freighter is not installed or locked." };
    }

    const response = await freighterApi.requestAccess();
    if (response.error) {
      return { ok: false, error: "Wallet connection failed." };
    }

    localStorage.setItem("walletPublicKey", response.address);
    setUserPublicKey(response.address);
    return { ok: true, address: response.address };
  };

  const handleDisconnectWallet = () => {
    localStorage.removeItem('walletPublicKey')
    setUserPublicKey('')
  }

  const [balance, setBalance] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  const loadBalance = useCallback(async () => {
    setIsRefreshing(true);
    setBalanceError("");
    try {
      const response = await fetch(`${HORIZON_BASE}/accounts/${userPublicKey}`);
      if (!response.ok) {
        throw new Error(`Horizon error (${response.status}).`);
      }

      const data = await response.json();
      const nativeBalance = data?.balances?.find(
        (item) => item.asset_type === "native",
      );
      const value = nativeBalance?.balance;
      setBalance(value ? Number(value) : null);
    } catch (error) {
      setBalance(null);
      setBalanceError(error.message || "Unable to load balance.");
    } finally {
      setIsRefreshing(false);
    }
  }, [userPublicKey]);

  useEffect(() => {
    if (!userPublicKey) {
      return;
    }
    const run = async () => {
      await loadBalance();
    };
    run();
  }, [userPublicKey, loadBalance]);

  useEffect(() => {
    const syncView = () => {
      const hash = window.location.hash;
      if (hash === "#register") {
        setActiveView("register");
        return;
      }

      if (hash === "#help") {
        setActiveView("help");
        return;
      }

      if (hash === "#analytics") {
        setActiveView("analytics");
        return;
      }

      if (hash === "#history") {
        setActiveView("history");
        return;
      }

      setActiveView("dashboard");
    };

    syncView();
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  const handleNavigate = useCallback((view) => {
    setActiveView(view);
    if (view === "register") {
      window.location.hash = "register";
      return;
    }

    if (view === "help") {
      window.location.hash = "help";
      return;
    }

    if (view === "analytics") {
      window.location.hash = "analytics";
      return;
    }

    if (view === "history") {
      window.location.hash = "history";
      return;
    }

    window.location.hash = "";
  }, []);

  const handleRegistrationStateChange = useCallback(
    (nextState) => {
      setRegistrationState(nextState);

      if (nextState === "new") {
        handleNavigate("register");
      }

      if (nextState === "existing" && activeView === "register") {
        handleNavigate("dashboard");
      }
    },
    [activeView, handleNavigate],
  );

  if (activeView === "register" && registrationState === "new") {
    return (
      <>
        {isOffline && (
          <div
            style={{
              backgroundColor: "#DC2626",
              color: "#FFFFFF",
              padding: "12px 16px",
              textAlign: "center",
              fontWeight: "500",
              fontSize: "14px",
              position: "sticky",
              top: 0,
              zIndex: 1000,
            }}
          >
            ⚠️ You are currently offline. Transactions will fail.
          </div>
        )}
        <Suspense fallback={<ViewFallback label="Loading registration..." />}>

        <RegistrationPage
          userPublicKey={userPublicKey}
          setUserPublicKey={setUserPublicKey}
          onBack={() => handleNavigate("dashboard")}
          onRegistered={() => handleRegistrationStateChange("existing")}
        />
        </Suspense>
      </>
    );
  }

  if (activeView === "help") {
    return (
      <>
        {isOffline && (
          <div
            style={{
              backgroundColor: "#DC2626",
              color: "#FFFFFF",
              padding: "12px 16px",
              textAlign: "center",
              fontWeight: "500",
              fontSize: "14px",
              position: "sticky",
              top: 0,
              zIndex: 1000,
            }}
          >
            ⚠️ You are currently offline. Transactions will fail.
          </div>
        )}
        <Suspense fallback={<ViewFallback label="Loading help center..." />}>

        <HelpPage
          userPublicKey={userPublicKey}
          onConnectWallet={handleConnectWallet}
          onDisconnectWallet={handleDisconnectWallet}
          onDashboardClick={() => handleNavigate("dashboard")}
          onAnalyticsClick={() => handleNavigate("analytics")}
          onHistoryClick={() => handleNavigate("history")}
          onRegisterClick={() => handleNavigate("register")}
          canRegister={registrationState === "new"}
        />
        </Suspense>
      </>
    );
  }

  if (activeView === "analytics") {
    return (
      <>
        {isOffline && (
          <div
            style={{
              backgroundColor: "#DC2626",
              color: "#FFFFFF",
              padding: "12px 16px",
              textAlign: "center",
              fontWeight: "500",
              fontSize: "14px",
              position: "sticky",
              top: 0,
              zIndex: 1000,
            }}
          >
            ⚠️ You are currently offline. Transactions will fail.
          </div>
        )}
        <Suspense fallback={<ViewFallback label="Loading analytics..." />}>

        <AnalyticsPage
          userPublicKey={userPublicKey}
          onConnectWallet={handleConnectWallet}
          onDisconnectWallet={handleDisconnectWallet}
          onDashboardClick={() => handleNavigate("dashboard")}
          onHistoryClick={() => handleNavigate("history")}
          onHelpClick={() => handleNavigate("help")}
          onRegisterClick={() => handleNavigate("register")}
          canRegister={registrationState === "new"}
        />
        </Suspense>
      </>
    );
  }

  if (activeView === "history") {
    return (
      <>
        {isOffline && (
          <div
            style={{
              backgroundColor: "#DC2626",
              color: "#FFFFFF",
              padding: "12px 16px",
              textAlign: "center",
              fontWeight: "500",
              fontSize: "14px",
              position: "sticky",
              top: 0,
              zIndex: 1000,
            }}
          >
            ⚠️ You are currently offline. Transactions will fail.
          </div>
        )}
        <Suspense fallback={<ViewFallback label="Loading history..." />}>

        <HistoryPage
          userPublicKey={userPublicKey}
          setUserPublicKey={setUserPublicKey}
          onConnectWallet={handleConnectWallet}
          onDisconnectWallet={handleDisconnectWallet}
          onRefreshBalance={loadBalance}
          onDashboardClick={() => handleNavigate("dashboard")}
          onAnalyticsClick={() => handleNavigate("analytics")}
          onHelpClick={() => handleNavigate("help")}
          onRegisterClick={() => handleNavigate("register")}
          canRegister={registrationState === "new"}
        />
        </Suspense>
      </>
    );
  }

  return (
    <>
      {isOffline && (
        <div
          style={{
            backgroundColor: "#DC2626",
            color: "#FFFFFF",
            padding: "12px 16px",
            textAlign: "center",
            fontWeight: "500",
            fontSize: "14px",
            position: "sticky",
            top: 0,
            zIndex: 1000,
          }}
        >
          ⚠️ You are currently offline. Transactions will fail.
        </div>
      )}
        <Suspense fallback={<ViewFallback label="Loading dashboard..." />}>

      <Dashboard
        userPublicKey={userPublicKey}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
        balance={balance}
        isRefreshing={isRefreshing}
        balanceError={balanceError}
        onRefreshBalance={loadBalance}
        onRegisterClick={() => handleNavigate("register")}
        onAnalyticsClick={() => handleNavigate("analytics")}
        onHistoryClick={() => handleNavigate("history")}
        onHelpClick={() => handleNavigate("help")}
        onRegistrationStateChange={handleRegistrationStateChange}
        canRegister={registrationState === "new"}
      />
        </Suspense>
    </>
  );
}

export default App;
