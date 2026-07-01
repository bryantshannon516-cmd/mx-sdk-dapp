/**
 * Unit tests for the `useGetIsWalletConnectReconnecting` hook.
 *
 * Covers:
 *  - Returns `false` when no strategy is provided
 *  - Returns the initial `isReconnecting` value synchronously
 *  - Updates to `true` when `isReconnecting` flips on the strategy
 *  - Returns to `false` and stops polling once reconnect completes
 *  - Cleans up the interval on unmount
 */

import { renderHook, act } from '@testing-library/react';
import { WalletConnectProviderStrategy } from 'providers/strategies/WalletConnectProviderStrategy';
import { useGetIsWalletConnectReconnecting } from '../useGetIsWalletConnectReconnecting';

// ── Lightweight strategy stub ────────────────────────────────────────────────

function makeStrategy(
  initial = false
): Pick<WalletConnectProviderStrategy, 'isReconnecting'> & {
  setReconnecting: (v: boolean) => void;
} {
  const stub = { isReconnecting: initial } as Pick<
    WalletConnectProviderStrategy,
    'isReconnecting'
  > & { setReconnecting: (v: boolean) => void };

  stub.setReconnecting = (v: boolean) => {
    stub.isReconnecting = v;
  };

  return stub;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useGetIsWalletConnectReconnecting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false when strategy is undefined', () => {
    const { result } = renderHook(() =>
      useGetIsWalletConnectReconnecting(undefined)
    );
    expect(result.current).toBe(false);
  });

  it('returns false when strategy is null', () => {
    const { result } = renderHook(() =>
      useGetIsWalletConnectReconnecting(null)
    );
    expect(result.current).toBe(false);
  });

  it('reflects the initial isReconnecting value synchronously', () => {
    const strategy = makeStrategy(true);

    const { result } = renderHook(() =>
      useGetIsWalletConnectReconnecting(
        strategy as unknown as WalletConnectProviderStrategy
      )
    );

    expect(result.current).toBe(true);
  });

  it('returns false for a strategy that starts with isReconnecting=false', () => {
    const strategy = makeStrategy(false);

    const { result } = renderHook(() =>
      useGetIsWalletConnectReconnecting(
        strategy as unknown as WalletConnectProviderStrategy
      )
    );

    expect(result.current).toBe(false);
  });

  it('updates to true when isReconnecting becomes true mid-flight', () => {
    const strategy = makeStrategy(false);

    const { result } = renderHook(() =>
      useGetIsWalletConnectReconnecting(
        strategy as unknown as WalletConnectProviderStrategy
      )
    );

    expect(result.current).toBe(false);

    // Simulate the strategy starting a reconnect attempt
    act(() => {
      strategy.setReconnecting(true);
      jest.advanceTimersByTime(150); // past the 100 ms polling interval
    });

    expect(result.current).toBe(true);
  });

  it('returns to false once reconnect completes', () => {
    const strategy = makeStrategy(true);

    const { result } = renderHook(() =>
      useGetIsWalletConnectReconnecting(
        strategy as unknown as WalletConnectProviderStrategy
      )
    );

    expect(result.current).toBe(true);

    // Simulate reconnect completing
    act(() => {
      strategy.setReconnecting(false);
      jest.advanceTimersByTime(150);
    });

    expect(result.current).toBe(false);
  });

  it('cleans up the polling interval on unmount', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const strategy = makeStrategy(true);

    const { unmount } = renderHook(() =>
      useGetIsWalletConnectReconnecting(
        strategy as unknown as WalletConnectProviderStrategy
      )
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('resets to false and stops polling when strategy prop changes to null', () => {
    const strategy = makeStrategy(true);

    const { result, rerender } = renderHook(
      ({ s }: { s: WalletConnectProviderStrategy | null }) =>
        useGetIsWalletConnectReconnecting(s),
      { initialProps: { s: strategy as unknown as WalletConnectProviderStrategy } }
    );

    expect(result.current).toBe(true);

    // Strategy is removed (e.g. provider is destroyed)
    act(() => {
      rerender({ s: null });
    });

    expect(result.current).toBe(false);
  });
});
