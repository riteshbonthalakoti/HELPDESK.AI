import { useState, useEffect } from 'react';

/**
 * useDebounce Hook
 *
 * Delays updating the debounced value until after the specified delay (in milliseconds)
 * has passed since the last time the input value changed.
 * Ideal for search input filtering, autocomplete queries, and costly re-renders.
 *
 * @template T
 * @param {T} value - The input value to debounce
 * @param {number} [delay=300] - Delay in milliseconds (defaults to 300ms)
 * @returns {T} The debounced value
 */
export function useDebounce(value, delay = 300) {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return debouncedValue;
}

export default useDebounce;
