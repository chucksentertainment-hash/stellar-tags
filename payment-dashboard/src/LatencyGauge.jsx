/**
 * Compact latency gauge component
 * Displays real-time API latency with visual indicator
 * 
 * @param {number|null} latency - Latency in milliseconds
 * @param {string} status - Status: idle, checking, healthy, unhealthy
 */
export const LatencyGauge = ({ latency, status }) => {
  // Determine color based on latency value and status
  const getColorClass = () => {
    if (status === 'checking') return 'checking'
    if (status === 'unhealthy') return 'unhealthy'
    if (latency === null) return 'idle'
    
    if (latency < 100) return 'excellent'
    if (latency < 200) return 'good'
    if (latency < 500) return 'fair'
    return 'poor'
  }

  const getLabel = () => {
    if (status === 'checking') return 'Checking...'
    if (status === 'unhealthy') return 'Offline'
    if (latency === null) return '--'
    return `${latency}ms`
  }

  const getAriaLabel = () => {
    if (status === 'checking') return 'API latency: checking'
    if (status === 'unhealthy') return 'API connection offline'
    if (latency === null) return 'API latency: unknown'
    return `API latency: ${latency} milliseconds`
  }

  return (
    <div className={`latency-gauge ${getColorClass()}`} aria-label={getAriaLabel()}>
      <div className="gauge-dot" />
      <span className="gauge-value">{getLabel()}</span>
    </div>
  )
}

export default LatencyGauge
