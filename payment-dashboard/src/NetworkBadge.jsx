const NETWORK = (import.meta.env.VITE_NETWORK || 'testnet').toLowerCase()
const isMainnet = NETWORK === 'mainnet' || NETWORK === 'public'

export default function NetworkBadge() {
  return (
    <span
      className="network-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.03em',
        backgroundColor: isMainnet ? '#D1FAE5' : '#FEF3C7',
        color: isMainnet ? '#065F46' : '#92400E',
        border: `1px solid ${isMainnet ? '#6EE7B7' : '#FCD34D'}`,
      }}
      aria-label={`Network: ${isMainnet ? 'Mainnet' : 'Testnet'}`}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: isMainnet ? '#059669' : '#D97706',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      {isMainnet ? 'Mainnet' : 'Testnet'}
    </span>
  )
}
