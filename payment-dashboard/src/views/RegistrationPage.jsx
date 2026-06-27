import { useEffect, useState } from 'react';
import freighterApi from '@stellar/freighter-api';
import LoadingSpinner from '../components/LoadingSpinner';
import { API_BASE, normalizeNameTag } from './shared';

const USERNAME_REGEX = /^[a-zA-Z0-9]/;

function RegistrationPage({
  userPublicKey,
  setUserPublicKey,
  onBack,
  onRegistered,
}) {
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [status, setStatus] = useState({
    text: "Connect a wallet to begin your registration.",
    tone: "neutral",
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const walletLabel = userPublicKey
    ? `Connected: ${userPublicKey.substring(0, 5)}...${userPublicKey.substring(51)}`
    : "No wallet connected";

  const setStatusMessage = (text, tone = "neutral") => {
    setStatus({ text, tone });
  };

  useEffect(() => {
    if (!userPublicKey) {
      return;
    }

    const checkExisting = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/lookup?address=${encodeURIComponent(userPublicKey)}`,
        );
        const rawBody = await response.text();
        const data = rawBody ? JSON.parse(rawBody) : null;

        if (response.ok && data?.username) {
          onRegistered();
        }
      } catch {
        // Ignore lookup errors in registration view.
      }
    };

    checkExisting();
  }, [userPublicKey, onRegistered]);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const connectionStatus = await freighterApi.isConnected();
      const isInstalled =
        connectionStatus.isConnected !== undefined
          ? connectionStatus.isConnected
          : connectionStatus;

      if (!isInstalled) {
        setStatusMessage("Freighter is not installed or locked.", "error");
        return;
      }

      const response = await freighterApi.requestAccess();
      if (response.error) {
        setStatusMessage("Wallet connection failed.", "error");
        return;
      }

      setUserPublicKey(response.address);
      setStatusMessage("Wallet connected. Pick your username.", "success");
    } catch {
      setStatusMessage("Unable to connect to Freighter.", "error");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleaned = username.trim();
    const normalizedUsername = normalizeNameTag(cleaned);

    if (!userPublicKey) {
      setStatusMessage("Connect a wallet before registering.", "error");
      return;
    }

    if (cleaned.length < 3) {
      setStatusMessage("Username must be at least 3 characters.", "error");
      return;
    }

    if (!USERNAME_REGEX.test(cleaned)) {
      setStatusMessage(
        "Username may only contain letters, numbers, hyphens, and underscores.",
        "error",
      );
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(
      "Approve the signature request in Freighter...",
      "neutral",
    );

    let signature;
    try {
      const message = `register:${normalizedUsername}:${userPublicKey}`;
      const result = await freighterApi.signMessage(message, {
        address: userPublicKey,
      });
      if (result.error) throw new Error(result.error);
      signature = result.signedMessage;
    } catch (err) {
      setStatusMessage(err.message || "Signature request cancelled.", "error");
      setIsSubmitting(false);
      return;
    }

    setStatusMessage("Submitting your registration...", "neutral");

    fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: normalizedUsername,
        address: userPublicKey,
        signature,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error((data && data.detail) || "Registration failed.");
        }

        return data;
      })
      .then(() => {
        setStatusMessage("Username reserved and saved.", "success");
      })
      .catch((error) => {
        setStatusMessage(error.message || "Registration failed.", "error");
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <div className="registration">
      <section className="hero-panel">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <p className="brand-eyebrow">Stellar Pay</p>
            <h1>Claim your on-chain identity.</h1>
          </div>
        </div>
        <p className="hero-copy">
          Register a username that follows your wallet across apps, tips, and
          payments. Secure, memorable, and ready for the Stellar network.
        </p>
        <div className="pill-row">
          <span>Instant wallet link</span>
          <span>Unique username</span>
          <span>Testnet ready</span>
        </div>
        <div className="hero-card">
          <div>
            <p className="card-label">Wallet status</p>
            <p className="card-value">{walletLabel}</p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={handleConnect}
          >
            {isConnecting ? "Connecting..." : "Connect wallet"}
          </button>
        </div>
        <div className="hero-grid">
          <div>
            <h3>Own your name</h3>
            <p>Secure a username that resolves to your wallet instantly.</p>
          </div>
          <div>
            <h3>Seamless onboarding</h3>
            <p>Freighter brings you in with a single approval.</p>
          </div>
          <div>
            <h3>Verified presence</h3>
            <p>Show a trusted badge to customers and collaborators.</p>
          </div>
        </div>
      </section>

      <section className="form-panel">
        <div className="form-header">
          <h2>Registration</h2>
          <p>Choose a name that your community will recognize.</p>
        </div>
        <form className="registration-form" onSubmit={handleSubmit}>
          <label className="form-field">
            Desired username
            <input
              type="text"
              placeholder="stellarname"
              value={username}
              onChange={(event) => {
                const val = event.target.value;
                setUsername(val);
                if (val && !USERNAME_REGEX.test(val)) {
                  setUsernameError(
                    "Only letters, numbers, hyphens, and underscores are allowed.",
                  );
                } else {
                  setUsernameError("");
                }
              }}
              aria-describedby={usernameError ? "username-error" : undefined}
              aria-invalid={!!usernameError}
            />
            {usernameError && (
              <span id="username-error" className="field-error" role="alert">
                {usernameError}
              </span>
            )}
          </label>
          <div className="helper-row">
            <span>3-18 characters, letters and numbers recommended.</span>
            <span
              className={`char-counter${username.length >= 30 ? " char-counter--limit" : ""}`}
            >
              {username.length} / 30
            </span>
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting || !!usernameError}
          >
            {isSubmitting ? <LoadingSpinner /> : "Reserve username"}
          </button>
        </form>
        <div className={`status-card ${status.tone}`}>
          <p>{status.text}</p>
        </div>
        <div className="form-footer">
          <button type="button" className="ghost-button" onClick={onBack}>
            Back to dashboard
          </button>
          <p>Wallet required to finalize registration.</p>
          <div className="badge-row">
            <span>Freighter</span>
            <span>Stellar Testnet</span>
            <span>Secure</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default RegistrationPage;
