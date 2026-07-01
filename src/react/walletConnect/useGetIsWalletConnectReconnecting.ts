import { useEffect, useState } from 'react';
import { WalletConnectProviderStrategy } from 'providers/strategies/WalletConnectProviderStrategy';

/**
 * Returns `true` while the `WalletConnectProviderStrategy` is performing a
 * silent session-reconnect attempt (e.g. after a page refresh).
 *
 * The hook accepts an optional reference to the active strategy instance so
 * that it can poll `isReconnecting` reactively.  When no instance is provided
 * the hook simply returns `false`.
 *
 * @example
 * ```tsx
 * const isReconnecting = useGetIsWalletConnectReconnecting(strategyRef.current);
 * if (isReconnecting) return <Spinner />;
 * ```
 */
export function useGetIsWalletConnectReconnecting(
  strategy?: WalletConnectProviderStrategy | null
): boolean {
  const [isReconnecting, setIsReconnecting] = useState<boolean>(
    () => strategy?.isReconnecting ?? false
  );

  useEffect(() => {
    if (!strategy) {
      setIsReconnecting(false);
      return;
    }

    // Immediately sync with the current value.
    setIsReconnecting(strategy.isReconnecting);

    // Poll every 100 ms until the reconnect attempt completes.  This keeps the
    // hook lightweight without requiring the strategy to emit events.
    const intervalId = setInterval(() => {
      const current = strategy.isReconnecting;
      setIsReconnecting((prev) => (prev !== current ? current : prev));

      if (!current) {
        clearInterval(intervalId);
      }
    }, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [strategy]);

  return isReconnecting;
}
