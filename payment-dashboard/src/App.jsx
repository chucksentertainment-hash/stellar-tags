import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import freighterApi from '@stellar/freighter-api'

const CONTRACT_ID = 'CDNQ7OMHIFOLZHOKWQLOGDW7CF3DRMKXJC6OULNGNBWF4O4NO2NEIGER'
const TREASURY_ADDRESS = 'GAAFWEZKDYPXLTQGKQ3F23TXWYQUDAYTDW7P7VUQSVJFW2GWC4Y6LWST'
const TOKEN_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const API_BASE = "https://stellar-tags-production.up.railway.app";
const DEFAULT_FEDERATION_DOMAIN = 'localhost'
const HORIZON_BASE = 'https://horizon-testnet.stellar.org'
const ANALYTICS_WINDOW_MS = 60 * 60 * 1000
const ANALYTICS_PAGE_LIMIT = 200
const ANALYTICS_MAX_PAGES = 5
const ANALYTICS_REFRESH_MS = 60 * 1000

let stellarSdkPromise
const loadStellarSdk = () => {
  if (!stellarSdkPromise) {
    stellarSdkPromise = import('@stellar/stellar-sdk')
  }

  return stellarSdkPromise
}

const normalizeNameTag = (value) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.includes('*') ? trimmed : `${trimmed}*${DEFAULT_FEDERATION_DOMAIN}`
}

const resolveRecipient = async (inputValue) => {
  const trimmed = inputValue.trim()
  if (!trimmed) {
    return { error: 'Please enter a username or wallet address.' }
  }

  const { StrKey } = await loadStellarSdk()
  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return { address: trimmed }
  }

  const normalizedTag = normalizeNameTag(trimmed)
  return { tag: normalizedTag }
}

const formatUsername = (value) => {
  if (!value) {
    return ''
  }

  return value.split('*')[0]
}

const formatShortAddress = (value) => {
  if (!value) {
    return ''
  }

  if (value.length < 10) {
    return value
  }

  return `${value.substring(0, 4)}...${value.substring(52)}`
}

const NAV_STORAGE_KEY = 'stellar-nav-open'

const useNavState = () => {
  const [isNavOpen, setIsNavOpen] = useState(() => {
    const stored = sessionStorage.getItem(NAV_STORAGE_KEY)
    if (stored === 'true' || stored === 'false') {
      return stored === 'true'
    }

    return window.matchMedia('(min-width: 769px)').matches
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncNav = (event) => {
      if (event.matches) {
        setIsNavOpen(false)
      }
    }

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', syncNav)
      return () => mediaQuery.removeEventListener('change', syncNav)
    }

    mediaQuery.addListener(syncNav)
    return () => mediaQuery.removeListener(syncNav)
  }, [])

  useEffect(() => {
    sessionStorage.setItem(NAV_STORAGE_KEY, String(isNavOpen))
  }, [isNavOpen])

  return [isNavOpen, setIsNavOpen]
}

const useWalletMenu = () => {
  const menuRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return { menuRef, isOpen, setIsOpen }
}

function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [userPublicKey, setUserPublicKey] = useState('')
  const [registrationState, setRegistrationState] = useState('unknown')

  const handleConnectWallet = async () => {
    const status = await freighterApi.isConnected()
    const isInstalled = status.isConnected !== undefined ? status.isConnected : status

    if (!isInstalled) {
      return { ok: false, error: 'Freighter is not installed or locked.' }
    }

    const response = await freighterApi.requestAccess()
    if (response.error) {
      return { ok: false, error: 'Wallet connection failed.' }
    }

    setUserPublicKey(response.address)
    return { ok: true, address: response.address }
  }

  const handleDisconnectWallet = () => {
    setUserPublicKey('')
  }

  const [balance, setBalance] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [balanceError, setBalanceError] = useState('')

  const loadBalance = async () => {
    if (!userPublicKey) {
      setBalance(null)
      setBalanceError('')
      return
    }

    setIsRefreshing(true)
    setBalanceError('')
    try {
      const response = await fetch(`${HORIZON_BASE}/accounts/${userPublicKey}`)
      if (!response.ok) {
        throw new Error(`Horizon error (${response.status}).`)
      }

      const data = await response.json()
      const nativeBalance = data?.balances?.find((item) => item.asset_type === 'native')
      const value = nativeBalance?.balance
      setBalance(value ? Number(value) : null)
    } catch (error) {
      setBalance(null)
      setBalanceError(error.message || 'Unable to load balance.')
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    loadBalance()
  }, [userPublicKey])

  useEffect(() => {
    const syncView = () => {
      const hash = window.location.hash
      if (hash === '#register') {
        setActiveView('register')
        return
      }

      if (hash === '#help') {
        setActiveView('help')
        return
      }

      if (hash === '#analytics') {
        setActiveView('analytics')
        return
      }

      if (hash === '#history') {
        setActiveView('history')
        return
      }

      setActiveView('dashboard')
    }

    syncView()
    window.addEventListener('hashchange', syncView)
    return () => window.removeEventListener('hashchange', syncView)
  }, [])

  const handleNavigate = (view) => {
    setActiveView(view)
    if (view === 'register') {
      window.location.hash = 'register'
      return
    }

    if (view === 'help') {
      window.location.hash = 'help'
      return
    }

    if (view === 'analytics') {
      window.location.hash = 'analytics'
      return
    }

    if (view === 'history') {
      window.location.hash = 'history'
      return
    }

    window.location.hash = ''
  }

  const handleRegistrationStateChange = (nextState) => {
    setRegistrationState(nextState)

    if (nextState === 'new') {
      handleNavigate('register')
    }

    if (nextState === 'existing' && activeView === 'register') {
      handleNavigate('dashboard')
    }
  }

  if (activeView === 'register' && registrationState === 'new') {
    return (
      <RegistrationPage
        userPublicKey={userPublicKey}
        setUserPublicKey={setUserPublicKey}
        onBack={() => handleNavigate('dashboard')}
        onRegistered={() => handleRegistrationStateChange('existing')}
      />
    )
  }

  if (activeView === 'help') {
    return (
      <HelpPage
        userPublicKey={userPublicKey}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
        onDashboardClick={() => handleNavigate('dashboard')}
        onAnalyticsClick={() => handleNavigate('analytics')}
        onHistoryClick={() => handleNavigate('history')}
        onRegisterClick={() => handleNavigate('register')}
        canRegister={registrationState === 'new'}
      />
    )
  }

  if (activeView === 'analytics') {
    return (
      <AnalyticsPage
        userPublicKey={userPublicKey}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
        onDashboardClick={() => handleNavigate('dashboard')}
        onHistoryClick={() => handleNavigate('history')}
        onHelpClick={() => handleNavigate('help')}
        onRegisterClick={() => handleNavigate('register')}
        canRegister={registrationState === 'new'}
      />
    )
  }

  if (activeView === 'history') {
    return (
      <HistoryPage
        userPublicKey={userPublicKey}
        setUserPublicKey={setUserPublicKey}
        onConnectWallet={handleConnectWallet}
        onDisconnectWallet={handleDisconnectWallet}
        onRefreshBalance={loadBalance}
        onDashboardClick={() => handleNavigate('dashboard')}
        onAnalyticsClick={() => handleNavigate('analytics')}
        onHelpClick={() => handleNavigate('help')}
        onRegisterClick={() => handleNavigate('register')}
        canRegister={registrationState === 'new'}
      />
    )
  }

  return (
    <Dashboard
      userPublicKey={userPublicKey}
      setUserPublicKey={setUserPublicKey}
      onConnectWallet={handleConnectWallet}
      onDisconnectWallet={handleDisconnectWallet}
      balance={balance}
      isRefreshing={isRefreshing}
      balanceError={balanceError}
      onRefreshBalance={loadBalance}
      onRegisterClick={() => handleNavigate('register')}
      onAnalyticsClick={() => handleNavigate('analytics')}
      onHistoryClick={() => handleNavigate('history')}
      onHelpClick={() => handleNavigate('help')}
      onRegistrationStateChange={handleRegistrationStateChange}
      canRegister={registrationState === 'new'}
    />
  )
}

function Dashboard({
  userPublicKey,
  setUserPublicKey,
  onConnectWallet,
  onDisconnectWallet,
  balance,
  isRefreshing,
  balanceError,
  onRefreshBalance,
  onRegisterClick,
  onAnalyticsClick,
  onHistoryClick,
  onHelpClick,
  onRegistrationStateChange,
  canRegister,
}) {
  const [isNavOpen, setIsNavOpen] = useNavState()
  const { menuRef, isOpen: isWalletMenuOpen, setIsOpen: setIsWalletMenuOpen } = useWalletMenu()
  const closeNav = () => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
  }
  const handleNav = (action) => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
    action()
  }
  const [nameTag, setNameTag] = useState('')
  const [amount, setAmount] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReceiving, setIsReceiving] = useState(false)
  const [activeBalancePanel, setActiveBalancePanel] = useState('')
  const [receiveAddress, setReceiveAddress] = useState('')
  const [receiveTag, setReceiveTag] = useState('')
  const [receiveStatus, setReceiveStatus] = useState({
    text: '',
    color: '#1F2937',
    bgColor: '#F3F4F6',
  })
  const [status, setStatus] = useState({
    text: '',
    color: '#1F2937',
    bgColor: '#F3F4F6',
  })

  const walletLabel = userPublicKey
    ? `Connected: ${userPublicKey.substring(0, 5)}...${userPublicKey.substring(51)}`
    : ''

  const displayMessage = (text, color, bgColor) => {
    setStatus({ text, color, bgColor })
  }

  const displayReceiveMessage = (text, color, bgColor) => {
    setReceiveStatus({ text, color, bgColor })
  }

  useEffect(() => {
    if (!userPublicKey) {
      setReceiveAddress('')
      setReceiveTag('')
      displayReceiveMessage('Connect your wallet to reveal your receive details.', '#1F2937', '#F3F4F6')
      onRegistrationStateChange('unknown')
      return
    }

    const loadReceiveDetails = async () => {
      setIsReceiving(true)
      displayReceiveMessage('Loading your receive details...', '#1F2937', '#F3F4F6')

      try {
        const response = await fetch(`${API_BASE}/lookup?address=${encodeURIComponent(userPublicKey)}`)
        const rawBody = await response.text()
        const data = rawBody ? JSON.parse(rawBody) : null

        if (response.ok && data) {
          setReceiveAddress(data.address)
          setReceiveTag(data.username)
          displayReceiveMessage('Share your username or wallet address.', '#059669', '#D1FAE5')
          onRegistrationStateChange('existing')
          return
        }

        if (response.status === 404) {
          setReceiveAddress(userPublicKey)
          setReceiveTag('')
          displayReceiveMessage('No username found. Register to claim one.', '#D97706', '#FEF3C7')
          onRegistrationStateChange('new')
          return
        }

        throw new Error((data && data.detail) || `Backend error (${response.status}).`)
      } catch (error) {
        setReceiveAddress(userPublicKey)
        setReceiveTag('')
        displayReceiveMessage(error.message || 'Unable to load receive details.', '#DC2626', '#FEE2E2')
        onRegistrationStateChange('unknown')
      } finally {
        setIsReceiving(false)
      }
    }

    loadReceiveDetails()
  }, [userPublicKey])

  const handleConnect = async () => {
    const result = await onConnectWallet()
    if (!result.ok) {
      displayMessage(result.error || 'Wallet connection failed.', '#DC2626', '#FEE2E2')
      return
    }

    displayMessage('Wallet connected.', '#059669', '#D1FAE5')
  }

  const handleLookup = async () => {
    const recipientInput = nameTag.trim()
    const amountValue = parseFloat(amount)

    if (!amountValue || Number.isNaN(amountValue) || amountValue <= 0) {
      displayMessage('Please enter a valid amount greater than zero.', '#DC2626', '#FEE2E2')
      return
    }

    setIsProcessing(true)

    try {
      // --- PHASE 1: RECIPIENT RESOLUTION ---
      displayMessage('Verifying recipient...', '#1F2937', '#F3F4F6')
      const resolved = await resolveRecipient(recipientInput)
      if (resolved.error) throw new Error(`Resolution error: ${resolved.error}`)
      
      let recipientAddress = resolved.address
      if (!recipientAddress && resolved.tag) {
        const response = await fetch(`${API_BASE}/federation?q=${encodeURIComponent(resolved.tag)}&type=name`)
        const data = response.ok ? await response.json() : null
        if (!data?.account_id) throw new Error('Recipient address could not be resolved from backend.')
        recipientAddress = data.account_id
      }

      // --- PHASE 2: TRANSACTION ASSEMBLY ---
      displayMessage('Simulating smart contract execution...', '#1F2937', '#F3F4F6')
      const StellarSdk = await loadStellarSdk()
      const amountStroops = BigInt(Math.floor(amountValue * 10000000))
      
      const contractArgs = [
        new StellarSdk.Address(userPublicKey).toScVal(),
        new StellarSdk.Address(recipientAddress).toScVal(),
        new StellarSdk.Address(TREASURY_ADDRESS).toScVal(),
        new StellarSdk.Address(TOKEN_ADDRESS).toScVal(),
        StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      ]

      const server = new StellarSdk.rpc.Server('https://soroban-testnet.stellar.org')
      const account = await server.getAccount(userPublicKey)
      const contract = new StellarSdk.Contract(CONTRACT_ID)

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: '100000',
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
        .addOperation(contract.call('route_payment', ...contractArgs))
        .setTimeout(300)
        .build()

      // --- PHASE 3: RPC SIMULATION ---
      let preparedTransaction;
      try {
         preparedTransaction = await server.prepareTransaction(transaction)
         if (preparedTransaction.error) {
           throw new Error(preparedTransaction.error.message || 'Simulation rejected by network.')
         }
      } catch (err) {
         throw new Error(`Simulation failed: ${err.message}`)
      }

      // --- PHASE 4: WALLET SIGNATURE ---
      displayMessage('Please approve the transaction in your wallet.', '#0052FF', '#EFF6FF')
      let signedXdrResponse;
      try {
        signedXdrResponse = await freighterApi.signTransaction(preparedTransaction.toXDR(), {
          network: 'TESTNET',
          networkPassphrase: 'Test SDF Network ; September 2015',
        })
        if (signedXdrResponse.error) throw new Error(signedXdrResponse.error)
      } catch (err) {
        throw new Error(`Wallet signature failed: ${err.message}`)
      }

      // --- PHASE 5: BLOCKCHAIN SUBMISSION ---
      displayMessage('Submitting to Stellar Testnet...', '#D97706', '#FEF3C7')
      try {
        const finalXdr = typeof signedXdrResponse === 'string' 
          ? signedXdrResponse 
          : signedXdrResponse.signedTxXdr || signedXdrResponse

        const rpcResponse = await fetch('https://soroban-testnet.stellar.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: { transaction: finalXdr }
          })
        })

        const rpcData = await rpcResponse.json()
        if (rpcData.error) throw new Error(`RPC Error: ${rpcData.error.message}`)

        const status = rpcData.result?.status
        if (status === 'PENDING' || status === 'SUCCESS') {
          displayMessage('Payment successful!', '#059669', '#D1FAE5')
          setAmount('')
          onRefreshBalance()
          window.dispatchEvent(new Event('stellar:tx-update'))
        } else {
          throw new Error(`Blockchain rejected transaction: ${status || 'Unknown'}`)
        }
      } catch (err) {
        throw new Error(`Submission failed: ${err.message}`)
      }

    } catch (error) {
      displayMessage(error.message || 'A critical error occurred.', '#DC2626', '#FEE2E2')
    } finally {
      setIsProcessing(false)
    }
  }


  const handleCopy = async (value, label) => {
    if (!value) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      displayReceiveMessage(`${label} copied to clipboard.`, '#059669', '#D1FAE5')
    } catch (error) {
      displayReceiveMessage('Copy failed. Please copy manually.', '#DC2626', '#FEE2E2')
    }
  }

  const handleDisconnect = () => {
    setIsWalletMenuOpen(false)
    onDisconnectWallet()
    displayMessage('Wallet disconnected.', '#1F2937', '#F3F4F6')
  }

  return (
    <div className={`dashboard ${isNavOpen ? 'nav-open' : ''}`}>
      <button
        type="button"
        className={`sidebar-scrim ${isNavOpen ? 'is-open' : ''}`}
        onClick={() => setIsNavOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${isNavOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <h1>Stellar Pay</h1>
        </div>
        <div className="nav">
          <button type="button" onClick={closeNav}>Dashboard</button>
          <button type="button" onClick={() => handleNav(onHistoryClick)}>History</button>
          <button type="button" onClick={() => handleNav(onAnalyticsClick)}>Analytics</button>
          <button type="button" onClick={() => handleNav(onHelpClick)}>Help</button>
          {canRegister && (
            <button type="button" onClick={() => handleNav(onRegisterClick)}>Registration</button>
          )}
        </div>
        <div className="sidebar-card">
          <h3>Network pulse</h3>
          <p>Testnet status is healthy. Avg confirmation 3.9s.</p>
        </div>
        <div className="sidebar-card">
          <h3>Support</h3>
          <p>Need a hand? Open the help panel for quick answers.</p>
        </div>
        {userPublicKey && (
          <button type="button" className="disconnect-button" onClick={handleDisconnect}>
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
            <h2 className="headline">Frictionless Stellar Finance.</h2>
            <p className="subtle">
              Experience frictionless finance with verified identities and real-time smart routing.
            </p>
          </div>
          <div className="topbar-actions">
            <span className="chip">Testnet</span>
            <div className="wallet-menu" ref={menuRef}>
              <button
                type="button"
                className="connect-pill"
                onClick={() => {
                  if (userPublicKey) {
                    setIsWalletMenuOpen((prev) => !prev)
                  } else {
                    handleConnect()
                  }
                }}
                aria-expanded={isWalletMenuOpen}
              >
                {userPublicKey
                  ? `Connected: ${formatShortAddress(userPublicKey)}`
                  : 'Connect wallet'}
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

        <section className="grid columns-1 balance-grid">
          <div className="card reveal balance-card">
            <div className="card-header">
              <h2>Current balance</h2>
              <button
                type="button"
                className={`refresh-button ${isRefreshing ? 'is-loading' : ''}`}
                onClick={onRefreshBalance}
                disabled={!userPublicKey || isRefreshing}
                aria-label="Refresh balance"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                  <path d="M20 4v6h-6" />
                </svg>
              </button>
            </div>
            {balanceError && <div className="balance-error">{balanceError}</div>}
            <div className="metric">
              {balance !== null ? balance.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }) : '--'}{' '}
              <span>XLM</span>
            </div>
            <div className="balance-tabs">
              <button
                type="button"
                className={activeBalancePanel === 'transfer' ? 'is-active' : ''}
                onClick={() => setActiveBalancePanel('transfer')}
              >
                Transfer
              </button>
              <button
                type="button"
                className={activeBalancePanel === 'receive' ? 'is-active' : ''}
                onClick={() => setActiveBalancePanel('receive')}
              >
                Receive
              </button>
            </div>
            {activeBalancePanel === 'transfer' && (
              <div className="balance-panel">
                {!userPublicKey && (
                  <div className="wallet-status">Connect your wallet to make a transfer.</div>
                )}
                {walletLabel && <div className="wallet-status">{walletLabel}</div>}
                <label>Recipient username or address</label>
                <input
                  type="text"
                  value={nameTag}
                  onChange={(event) => setNameTag(event.target.value)}
                  placeholder="e.g., walzeem or G..."
                  autoComplete="off"
                  disabled={!userPublicKey || isProcessing}
                />

                <label>Amount (XLM)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  disabled={!userPublicKey || isProcessing}
                />

                <button
                  type="button"
                  className="accent-btn"
                  onClick={handleLookup}
                  disabled={!userPublicKey || isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'Transfer'}
                </button>
              </div>
            )}
            {activeBalancePanel === 'receive' && (
              <div className="balance-panel">
                {!userPublicKey && (
                  <div className="wallet-status">Connect your wallet to view receive details.</div>
                )}
                {userPublicKey && receiveAddress && (
                  <div className="receive-panel">
                    {receiveTag && (
                      <div className="wallet-status">
                        Username: {formatUsername(receiveTag)}
                      </div>
                    )}
                    <div className="wallet-status">
                      Address: {receiveAddress}
                    </div>
                    <div className="inline-actions">
                      {receiveTag && (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => handleCopy(formatUsername(receiveTag), 'Username')}
                          disabled={isReceiving}
                        >
                          Copy username
                        </button>
                      )}
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => handleCopy(receiveAddress, 'Address')}
                        disabled={isReceiving}
                      >
                        Copy address
                      </button>
                    </div>
                    <div className="qr-card">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(receiveAddress)}`}
                        alt="Wallet address QR code"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {status.text && (
              <div
                id="status-box"
                style={{ color: status.color, backgroundColor: status.bgColor }}
              >
                {status.text}
              </div>
            )}
          </div>
        </section>

      </main>
      <MobileNav
        active="dashboard"
        onDashboardClick={closeNav}
        onHistoryClick={() => handleNav(onHistoryClick)}
        onAnalyticsClick={() => handleNav(onAnalyticsClick)}
        onHelpClick={() => handleNav(onHelpClick)}
        onRegisterClick={() => handleNav(onRegisterClick)}
        canRegister={canRegister}
      />
    </div>
  )
}

function HelpPage({
  userPublicKey,
  onDisconnectWallet,
  onDashboardClick,
  onAnalyticsClick,
  onHistoryClick,
  onRegisterClick,
  canRegister,
}) {
  const [isNavOpen, setIsNavOpen] = useNavState()
  const [activeHelpAction, setActiveHelpAction] = useState('')
  const closeNav = () => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
  }
  const handleNav = (action) => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
    action()
  }

  const helpContent = {
    identity: (
      <div className="help-action-content">
        <p>
          Our platform uses a Federation Server. This acts as a decentralized phonebook that maps
          your easy-to-read name tag directly to your cryptographic public key.
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
          Note: Once claimed, your name tag is permanent and can be shared with anyone on the
          network to receive instant payments.
        </p>
      </div>
    ),
    troubleshooting: (
      <div className="help-action-content">
        <p>
          <strong>Simulation Failed:</strong> If the dashboard says "Simulation Failed," it usually
          means the smart contract rejected the logic. Ensure you aren't trying to send more XLM
          than you actually have in your balance (including the 0.4% fee, capped at 30 XLM).
        </p>
        <p>
          <strong>Wallet Locked:</strong> If the Freighter popup doesn't appear, check the
          extension icon in your browser. If it has a red dot or says "Locked," you must re-enter
          your password before the dashboard can request a signature.
        </p>
      </div>
    ),
  }
  return (
    <div className={`dashboard ${isNavOpen ? 'nav-open' : ''}`}>
      <button
        type="button"
        className={`sidebar-scrim ${isNavOpen ? 'is-open' : ''}`}
        onClick={() => setIsNavOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${isNavOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <h1>Stellar Pay</h1>
        </div>
        <div className="nav">
          <button type="button" onClick={() => handleNav(onDashboardClick)}>Dashboard</button>
          <button type="button" onClick={() => handleNav(onHistoryClick)}>History</button>
          <button type="button" onClick={() => handleNav(onAnalyticsClick)}>Analytics</button>
          <button type="button" aria-current="page" onClick={closeNav}>Help</button>
          {canRegister && (
            <button type="button" onClick={() => handleNav(onRegisterClick)}>Registration</button>
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
          <button type="button" className="disconnect-button" onClick={onDisconnectWallet}>
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
                  className={activeHelpAction === 'identity' ? 'is-active' : ''}
                  onClick={() =>
                    setActiveHelpAction((prev) => (prev === 'identity' ? '' : 'identity'))
                  }
                >
                  Claim Identity
                </button>
                <button type="button">Smart Routing</button>
                <button
                  type="button"
                  className={activeHelpAction === 'troubleshooting' ? 'is-active' : ''}
                  onClick={() =>
                    setActiveHelpAction((prev) => (prev === 'troubleshooting' ? '' : 'troubleshooting'))
                  }
                >
                  Troubleshooting
                </button>
            </div>
              <div
                className={`help-action-panel ${activeHelpAction ? 'is-visible' : ''}`}
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
    </div>
  )
}

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
  const [isNavOpen, setIsNavOpen] = useNavState()
  const [isConnecting, setIsConnecting] = useState(false)
  const [analyticsMetrics, setAnalyticsMetrics] = useState({
    routingVolume: null,
    avgConfirmation: null,
    successRate: null,
  })
  const { menuRef, isOpen: isWalletMenuOpen, setIsOpen: setIsWalletMenuOpen } = useWalletMenu()
  const closeNav = () => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
  }
  const handleNav = (action) => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
    action()
  }

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      await onConnectWallet()
    } finally {
      setIsConnecting(false)
    }
  }

  useEffect(() => {
    let isActive = true
    let currentController = null

    const fetchHorizon = async (url, signal) => {
      const response = await fetch(url, { signal, cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Horizon error (${response.status}).`)
      }

      return response.json()
    }

    const loadRoutingVolume = async (sinceMs, signal) => {
      let url = `${HORIZON_BASE}/payments?order=desc&limit=${ANALYTICS_PAGE_LIMIT}`
      let pages = 0
      let total = 0

      while (url && pages < ANALYTICS_MAX_PAGES) {
        const data = await fetchHorizon(url, signal)
        const records = data?._embedded?.records ?? []
        if (records.length === 0) {
          break
        }

        let reachedWindowEnd = false
        for (const record of records) {
          const createdAt = Date.parse(record.created_at)
          if (!Number.isFinite(createdAt) || createdAt < sinceMs) {
            reachedWindowEnd = true
            break
          }

          if (record.asset_type === 'native' && record.amount) {
            total += Number(record.amount)
          }
        }

        if (reachedWindowEnd) {
          break
        }

        url = data?._links?.next?.href
        pages += 1
      }

      return Number.isFinite(total) ? total : null
    }

    const loadSuccessRate = async (sinceMs, signal) => {
      let url = `${HORIZON_BASE}/transactions?order=desc&limit=${ANALYTICS_PAGE_LIMIT}`
      let pages = 0
      let total = 0
      let successCount = 0

      while (url && pages < ANALYTICS_MAX_PAGES) {
        const data = await fetchHorizon(url, signal)
        const records = data?._embedded?.records ?? []
        if (records.length === 0) {
          break
        }

        let reachedWindowEnd = false
        for (const record of records) {
          const createdAt = Date.parse(record.created_at)
          if (!Number.isFinite(createdAt) || createdAt < sinceMs) {
            reachedWindowEnd = true
            break
          }

          total += 1
          if (record.successful) {
            successCount += 1
          }
        }

        if (reachedWindowEnd) {
          break
        }

        url = data?._links?.next?.href
        pages += 1
      }

      if (total === 0) {
        return null
      }

      return (successCount / total) * 100
    }

    const loadAvgConfirmation = async (sinceMs, signal) => {
      let url = `${HORIZON_BASE}/ledgers?order=desc&limit=${ANALYTICS_PAGE_LIMIT}`
      let pages = 0
      let previousClosedAt = null
      let totalDelta = 0
      let deltaCount = 0

      while (url && pages < ANALYTICS_MAX_PAGES) {
        const data = await fetchHorizon(url, signal)
        const records = data?._embedded?.records ?? []
        if (records.length === 0) {
          break
        }

        let reachedWindowEnd = false
        for (const record of records) {
          const closedAt = Date.parse(record.closed_at)
          if (!Number.isFinite(closedAt) || closedAt < sinceMs) {
            reachedWindowEnd = true
            break
          }

          if (previousClosedAt !== null) {
            const deltaSeconds = (previousClosedAt - closedAt) / 1000
            if (deltaSeconds > 0) {
              totalDelta += deltaSeconds
              deltaCount += 1
            }
          }

          previousClosedAt = closedAt
        }

        if (reachedWindowEnd) {
          break
        }

        url = data?._links?.next?.href
        pages += 1
      }

      if (deltaCount === 0) {
        return null
      }

      return totalDelta / deltaCount
    }

    const loadMetrics = async () => {
      if (currentController) {
        currentController.abort()
      }

      const controller = new AbortController()
      currentController = controller
      const sinceMs = Date.now() - ANALYTICS_WINDOW_MS

      try {
        const [routingVolume, avgConfirmation, successRate] = await Promise.all([
          loadRoutingVolume(sinceMs, controller.signal),
          loadAvgConfirmation(sinceMs, controller.signal),
          loadSuccessRate(sinceMs, controller.signal),
        ])

        if (!isActive) {
          return
        }

        setAnalyticsMetrics({
          routingVolume,
          avgConfirmation,
          successRate,
        })
      } catch (error) {
        if (!isActive || error.name === 'AbortError') {
          return
        }

        setAnalyticsMetrics({
          routingVolume: null,
          avgConfirmation: null,
          successRate: null,
        })
      } finally {
        if (currentController === controller) {
          currentController = null
        }
      }
    }

    loadMetrics()
    const intervalId = setInterval(loadMetrics, ANALYTICS_REFRESH_MS)

    return () => {
      isActive = false
      if (currentController) {
        currentController.abort()
      }
      clearInterval(intervalId)
    }
  }, [])

  const formatNumber = (value, options = {}) =>
    new Intl.NumberFormat('en-US', options).format(value)

  const fallbackValue = '--'
  const routingVolumeValue =
    analyticsMetrics.routingVolume === null
      ? fallbackValue
      : formatNumber(analyticsMetrics.routingVolume, { maximumFractionDigits: 2 })
  const avgConfirmationValue =
    analyticsMetrics.avgConfirmation === null
      ? fallbackValue
      : analyticsMetrics.avgConfirmation.toFixed(2)
  const successRateValue =
    analyticsMetrics.successRate === null
      ? fallbackValue
      : analyticsMetrics.successRate.toFixed(1)

  return (
    <div className={`dashboard ${isNavOpen ? 'nav-open' : ''}`}>
      <button
        type="button"
        className={`sidebar-scrim ${isNavOpen ? 'is-open' : ''}`}
        onClick={() => setIsNavOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${isNavOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <h1>Stellar Pay</h1>
        </div>
        <div className="nav">
          <button type="button" onClick={() => handleNav(onDashboardClick)}>Dashboard</button>
          <button type="button" onClick={() => handleNav(onHistoryClick)}>History</button>
          <button type="button" aria-current="page" onClick={closeNav}>Analytics</button>
          <button type="button" onClick={() => handleNav(onHelpClick)}>Help</button>
          {canRegister && (
            <button type="button" onClick={() => handleNav(onRegisterClick)}>Registration</button>
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
          <button type="button" className="disconnect-button" onClick={onDisconnectWallet}>
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
            <p className="subtle">Verified proof of every route, settlement speed, and platform success.</p>
          </div>
          <div className="topbar-actions">
            <span className="chip">Testnet</span>
            <div className="wallet-menu" ref={menuRef}>
              <button
                type="button"
                className="connect-pill"
                onClick={() => {
                  if (userPublicKey) {
                    setIsWalletMenuOpen((prev) => !prev)
                  } else {
                    handleConnect()
                  }
                }}
                disabled={isConnecting}
                aria-expanded={isWalletMenuOpen}
              >
                {userPublicKey
                  ? `Connected: ${formatShortAddress(userPublicKey)}`
                  : isConnecting
                    ? 'Connecting...'
                    : 'Connect wallet'}
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
            <div className="metric">{routingVolumeValue} <span>XLM</span></div>
          </div>
          <div className="card reveal">
            <div className="card-header">
              <h2>Avg confirmation</h2>
              <span className="badge">Network</span>
            </div>
            <div className="metric">{avgConfirmationValue} <span>sec</span></div>
          </div>
          <div className="card reveal">
            <div className="card-header">
              <h2>Routing reliability</h2>
              <span className="badge">Last 1h</span>
            </div>
            <div className="metric">{successRateValue} <span>percent</span></div>
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
    </div>
  )
}

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
  const [isNavOpen, setIsNavOpen] = useNavState()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [history, setHistory] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const { menuRef, isOpen: isWalletMenuOpen, setIsOpen: setIsWalletMenuOpen } = useWalletMenu()
  const closeNav = () => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
  }
  const handleNav = (action) => {
    sessionStorage.setItem(NAV_STORAGE_KEY, 'false')
    setIsNavOpen(false)
    action()
  }

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      const result = await onConnectWallet()
      if (result?.address) {
        setUserPublicKey(result.address)
      }
    } finally {
      setIsConnecting(false)
    }
  }
  const handleDisconnect = () => {
    onDisconnectWallet()
  }

  const loadHistory = useCallback(async (signal) => {
    if (!userPublicKey) {
      setHistory([])
      setHistoryError('')
      return
    }

    setIsLoading(true)
    setHistoryError('')
    try {
      const response = await fetch(
        `${HORIZON_BASE}/accounts/${userPublicKey}/payments?order=desc&limit=25`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error(`Horizon error (${response.status}).`)
      }

      const data = await response.json()
      const records = data?._embedded?.records ?? []
      const filtered = records.filter((record) =>
        [
          'payment',
          'path_payment_strict_receive',
          'path_payment_strict_send',
          'create_account',
          'account_merge',
          'invoke_host_function',
        ].includes(record.type),
      )
      const formatted = filtered
        .flatMap((record) => {
          if (record.type === 'invoke_host_function' && record.asset_balance_changes?.length) {
            const changes = record.asset_balance_changes
              .filter((change) => change.asset_type === 'native')
              .filter((change) => change.from === userPublicKey || change.to === userPublicKey)

            return changes.map((change, index) => {
              const direction = change.from === userPublicKey ? 'Sent' : 'Received'
              const counterparty = change.from === userPublicKey ? change.to : change.from
              const amount = `${change.amount} XLM`
              const status = record.transaction_successful === false ? 'Failed' : 'Success'
              const explorerLink = record.transaction_hash
                ? `https://stellar.expert/explorer/testnet/tx/${record.transaction_hash}`
                : ''

              return {
                id: `${record.id}-${index}`,
                counterparty: counterparty || 'Unknown',
                direction,
                amount,
                status,
                type: record.type,
                createdAt: record.created_at,
                transactionHash: record.transaction_hash,
                asset: 'XLM',
                explorerLink,
              }
            })
          }

          const isSender = record.from === userPublicKey || record.account === userPublicKey
          const isReceiver = record.to === userPublicKey || record.into === userPublicKey
          const direction = isSender && !isReceiver ? 'Sent' : isReceiver ? 'Received' : 'Sent'
          const counterparty =
            direction === 'Sent'
              ? record.to || record.into || record.account || 'Unknown'
              : record.from || record.funder || record.account || 'Unknown'

          const asset = record.asset_type === 'native' ? 'XLM' : record.asset_code || 'Asset'
          const rawAmount = record.amount || record.starting_balance || ''
          const amount = rawAmount ? `${rawAmount} ${asset}` : '-'
          const status = record.transaction_successful === false ? 'Failed' : 'Success'
          const explorerLink = record.transaction_hash
            ? `https://stellar.expert/explorer/testnet/tx/${record.transaction_hash}`
            : ''

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
          ]
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

      const latest = formatted[0]
      if (latest?.status === 'Success') {
        const lastSeen = sessionStorage.getItem('stellar-last-tx')
        const latestKey = `${latest.transactionHash || latest.id}-${latest.amount}`
        if (latestKey !== lastSeen) {
          sessionStorage.setItem('stellar-last-tx', latestKey)
          onRefreshBalance()
        }
      }

      setHistory(formatted)
    } catch (error) {
      if (error.name !== 'AbortError') {
        setHistoryError(error.message || 'Unable to load transaction history.')
      }
    } finally {
      setIsLoading(false)
    }
  }, [onRefreshBalance, userPublicKey])

  useEffect(() => {
    const controller = new AbortController()
    loadHistory(controller.signal)
    return () => controller.abort()
  }, [loadHistory, refreshIndex, userPublicKey])

  useEffect(() => {
    const handleUpdate = () => {
      setRefreshIndex((value) => value + 1)
    }

    window.addEventListener('stellar:tx-update', handleUpdate)
    return () => window.removeEventListener('stellar:tx-update', handleUpdate)
  }, [])
  return (
    <div className={`dashboard ${isNavOpen ? 'nav-open' : ''}`}>
      <button
        type="button"
        className={`sidebar-scrim ${isNavOpen ? 'is-open' : ''}`}
        onClick={() => setIsNavOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={`sidebar ${isNavOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <h1>Stellar Pay</h1>
        </div>
        <div className="nav">
          <button type="button" onClick={() => handleNav(onDashboardClick)}>Dashboard</button>
          <button type="button" aria-current="page" onClick={closeNav}>History</button>
          <button type="button" onClick={() => handleNav(onAnalyticsClick)}>Analytics</button>
          <button type="button" onClick={() => handleNav(onHelpClick)}>Help</button>
          {canRegister && (
            <button type="button" onClick={() => handleNav(onRegisterClick)}>Registration</button>
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
          <button type="button" className="disconnect-button" onClick={onDisconnectWallet}>
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
            <p className="subtle">Connect your wallet to review recent transactions.</p>
          </div>
          <div className="topbar-actions">
            <span className="chip">Last 24 hours</span>
            <span className="chip">Testnet</span>
            <div className="wallet-menu" ref={menuRef}>
              <button
                type="button"
                className="connect-pill"
                onClick={() => {
                  if (userPublicKey) {
                    setIsWalletMenuOpen((prev) => !prev)
                  } else {
                    handleConnect()
                  }
                }}
                disabled={isConnecting}
                aria-expanded={isWalletMenuOpen}
              >
                {userPublicKey
                  ? `Connected: ${formatShortAddress(userPublicKey)}`
                  : isConnecting
                    ? 'Connecting...'
                    : 'Connect wallet'}
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
                className={`refresh-button ${isLoading ? 'is-loading' : ''}`}
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
              <button type="button" onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? 'Connecting...' : 'Connect wallet'}
              </button>
            </div>
          )}
          {userPublicKey && isLoading && (
            <div className="wallet-status">Loading transactions...</div>
          )}
          {userPublicKey && historyError && (
            <div className="wallet-status">{historyError}</div>
          )}
          {userPublicKey && !isLoading && !historyError && history.length === 0 && (
            <div className="wallet-status">No transactions found for this wallet.</div>
          )}
          {userPublicKey && !isLoading && !historyError && history.length > 0 && (
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
                            setExpandedId((current) => (current === entry.id ? null : entry.id))
                          }
                        >
                          {expandedId === entry.id ? 'Hide' : 'View'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr className="details-row">
                        <td colSpan={5}>
                          <div className="details-panel">
                            <div><strong>Type:</strong> {entry.type}</div>
                            <div><strong>Counterparty:</strong> {entry.counterparty}</div>
                            <div><strong>Asset:</strong> {entry.asset}</div>
                            <div><strong>Time:</strong> {new Date(entry.createdAt).toLocaleString()}</div>
                            <div>
                              <strong>Hash:</strong>{' '}
                              {entry.transactionHash || 'Unavailable'}
                            </div>
                            {entry.explorerLink && (
                              <div>
                                <a className="details-link" href={entry.explorerLink} target="_blank" rel="noreferrer">
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
    </div>
  )
}

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
        className={active === 'dashboard' ? 'is-active' : ''}
        onClick={onDashboardClick}
        aria-current={active === 'dashboard' ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
        <span>Dashboard</span>
      </button>
      <button
        type="button"
        className={active === 'history' ? 'is-active' : ''}
        onClick={onHistoryClick}
        aria-current={active === 'history' ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16M6 12h12M9 19h6" />
        </svg>
        <span>History</span>
      </button>
      <button
        type="button"
        className={active === 'analytics' ? 'is-active' : ''}
        onClick={onAnalyticsClick}
        aria-current={active === 'analytics' ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5m5 14V9m5 10v-6m5 6V7" />
        </svg>
        <span>Analytics</span>
      </button>
      <button
        type="button"
        className={active === 'help' ? 'is-active' : ''}
        onClick={onHelpClick}
        aria-current={active === 'help' ? 'page' : undefined}
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
          className={active === 'register' ? 'is-active' : ''}
          onClick={onRegisterClick}
          aria-current={active === 'register' ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
            <path d="M5 21a7 7 0 0 1 14 0" />
          </svg>
          <span>Register</span>
        </button>
      )}
    </nav>
  )
}

function RegistrationPage({ userPublicKey, setUserPublicKey, onBack, onRegistered }) {
  const [username, setUsername] = useState('')
  const [status, setStatus] = useState({
    text: 'Connect a wallet to begin your registration.',
    tone: 'neutral',
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const walletLabel = userPublicKey
    ? `Connected: ${userPublicKey.substring(0, 5)}...${userPublicKey.substring(51)}`
    : 'No wallet connected'

  const setStatusMessage = (text, tone = 'neutral') => {
    setStatus({ text, tone })
  }

  useEffect(() => {
    if (!userPublicKey) {
      return
    }

    const checkExisting = async () => {
      try {
        const response = await fetch(`${API_BASE}/lookup?address=${encodeURIComponent(userPublicKey)}`)
        const rawBody = await response.text()
        const data = rawBody ? JSON.parse(rawBody) : null

        if (response.ok && data?.username) {
          onRegistered()
        }
      } catch (error) {
        // Ignore lookup errors in registration view.
      }
    }

    checkExisting()
  }, [userPublicKey, onRegistered])

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      const connectionStatus = await freighterApi.isConnected()
      const isInstalled =
        connectionStatus.isConnected !== undefined
          ? connectionStatus.isConnected
          : connectionStatus

      if (!isInstalled) {
        setStatusMessage('Freighter is not installed or locked.', 'error')
        return
      }

      const response = await freighterApi.requestAccess()
      if (response.error) {
        setStatusMessage('Wallet connection failed.', 'error')
        return
      }

      setUserPublicKey(response.address)
      setStatusMessage('Wallet connected. Pick your username.', 'success')
    } catch (error) {
      setStatusMessage('Unable to connect to Freighter.', 'error')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const cleaned = username.trim()
    const normalizedUsername = normalizeNameTag(cleaned)

    if (!userPublicKey) {
      setStatusMessage('Connect a wallet before registering.', 'error')
      return
    }

    if (cleaned.length < 3) {
      setStatusMessage('Username must be at least 3 characters.', 'error')
      return
    }

    setIsSubmitting(true)
    setStatusMessage('Submitting your registration...', 'neutral')

    fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: normalizedUsername,
        address: userPublicKey,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((data && data.detail) || 'Registration failed.')
        }

        return data
      })
      .then(() => {
        setStatusMessage('Username reserved and saved.', 'success')
      })
      .catch((error) => {
        setStatusMessage(error.message || 'Registration failed.', 'error')
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

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
          <button type="button" className="ghost-button" onClick={handleConnect}>
            {isConnecting ? 'Connecting...' : 'Connect wallet'}
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
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <div className="helper-row">
            <span>3-18 characters, letters and numbers recommended.</span>
          </div>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Reserving...' : 'Reserve username'}
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
  )
}

export default App
