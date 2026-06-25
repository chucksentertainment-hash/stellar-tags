import { useState, useEffect, useRef, useCallback } from 'react'

const LATENCY_CHECK_INTERVAL = 30 * 1000 // 30 seconds
const HEALTH_ENDPOINT = '/health'

/**
 * Custom hook for tracking real-time API latency
 * Performs periodic ping to /health endpoint and calculates delta time
 * 
 * @param {string} apiBase - Base URL for API calls
 * @returns {Object} Object containing latency value and status
 */
export const useLatencyTracker = (apiBase = '') => {
  const [latency, setLatency] = useState(null)
  const [status, setStatus] = useState('idle') // idle, checking, healthy, unhealthy
  const intervalRef = useRef(null)

  const checkLatency = useCallback(async () => {
    try {
      setStatus('checking')
      const startTime = performance.now()
      
      const response = await fetch(`${apiBase}${HEALTH_ENDPOINT}`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })
      
      const endTime = performance.now()
      const delta = Math.round(endTime - startTime)
      
      if (response.ok) {
        setLatency(delta)
        setStatus('healthy')
      } else {
        setStatus('unhealthy')
        setLatency(null)
      }
    } catch (err) {
      setStatus('unhealthy')
      setLatency(null)
      console.warn('Latency check failed:', err instanceof Error ? err.message : 'Unknown error')
    }
  }, [apiBase])

  // Initial check on mount and when apiBase changes
  useEffect(() => {
    // Execute async function in effect
    const executeCheck = async () => {
      await checkLatency()
    }
    executeCheck()
  }, [checkLatency])

  // Set up periodic checks
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    intervalRef.current = setInterval(() => {
      checkLatency()
    }, LATENCY_CHECK_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [checkLatency])

  return {
    latency,
    status,
    isHealthy: status === 'healthy',
    isChecking: status === 'checking',
  }
}
