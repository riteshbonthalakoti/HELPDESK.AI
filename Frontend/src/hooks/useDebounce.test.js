import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebounce } from './useDebounce';

describe('useDebounce hook', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('returns initial value immediately', () => {
        const { result } = renderHook(() => useDebounce('initial', 300));
        expect(result.current).toBe('initial');
    });

    it('does not update value before specified delay passes', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 300 } }
        );

        rerender({ value: 'updated', delay: 300 });

        // Advance 200ms (less than 300ms delay)
        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(result.current).toBe('initial');
    });

    it('updates value after delay expires', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 300 } }
        );

        rerender({ value: 'updated', delay: 300 });

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current).toBe('updated');
    });

    it('debounces rapid sequential updates and only applies the final value', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebounce(value, 300),
            { initialProps: { value: 'first' } }
        );

        rerender({ value: 'second' });
        act(() => {
            vi.advanceTimersByTime(100);
        });

        rerender({ value: 'third' });
        act(() => {
            vi.advanceTimersByTime(100);
        });

        rerender({ value: 'final' });
        expect(result.current).toBe('first');

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current).toBe('final');
    });
});
