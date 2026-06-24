import { useEffect, useState } from 'react'

/**
 * Custom hook for debouncing a value.
 * Returns a debounced version of the input value after the specified delay.
 *
 * @param {*} value - The value to debounce
 * @param {number} delay - The debounce delay in milliseconds
 * @returns {*} The debounced value
 */
export const useDebounce = (value, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}
