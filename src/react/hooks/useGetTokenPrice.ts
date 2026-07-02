import { useEffect, useRef, useState } from 'react';
import {
  clearTokenPriceCache,
  getTokenPrice,
  TOKEN_PRICE_CACHE_TTL_MS,
  TokenPriceType
} from 'apiCalls/tokens/getTokenPrice';
import { useGetNetworkConfig } from 'react/hooks/useGetNetworkConfig';

export interface UseGetTokenPriceReturnType {
  /**
   * The current USD price for the requested token, or `null` while
   * loading or when an error has occurred.
   */
  price: number | null;
  /** `true` while a network request is in flight. */
  isLoading: boolean;
  /**
   * The error thrown by the last failed request, or `null` if the last
   * request succeeded (or no request has been made yet).
   */
  error: Error | null;
}

/**
 * React hook that fetches and caches the current USD price for a token.
 *
 * ### Caching
 * Results are kept in an in-memory cache for `ttlMs` milliseconds
 * (default: {@link TOKEN_PRICE_CACHE_TTL_MS}, currently **30 s**).
 * Multiple hook instances requesting the same token share the same
 * cached value; only the first request in any given TTL window hits
 * the network.
 *
 * ### Network-change invalidation
 * The hook reads the active network configuration from the Zustand
 * store via {@link useGetNetworkConfig}. Whenever the API address
 * changes (e.g. the dApp switches between mainnet and devnet) the
 * entire in-memory cache is cleared and a fresh request is issued
 * automatically.
 *
 * ### Race-condition safety
 * If `tokenId` changes before the in-flight request resolves, the
 * stale response is silently discarded via an effect cleanup flag,
 * so the component never sees an out-of-date price.
 *
 * @param tokenId - The on-chain token identifier, e.g. `"WEGLD-bd4d79"`.
 *                  Passing an empty string is a no-op — the hook returns
 *                  `{ price: null, isLoading: false, error: null }`.
 * @param ttlMs   - Optional override for the in-memory cache TTL (ms).
 *
 * @example
 * ```tsx
 * const { price, isLoading, error } = useGetTokenPrice('WEGLD-bd4d79');
 *
 * if (isLoading) return <Spinner />;
 * if (error)     return <p>Error: {error.message}</p>;
 * return <p>WEGLD price: ${price?.toFixed(4)}</p>;
 * ```
 */
export function useGetTokenPrice(
  tokenId: string,
  ttlMs: number = TOKEN_PRICE_CACHE_TTL_MS
): UseGetTokenPriceReturnType {
  const [price, setPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Observe the active network config so we can react to network switches.
  const { network } = useGetNetworkConfig();
  const apiAddress: string = network?.apiAddress ?? '';

  // Track the previous API address to detect when the network changes
  // between renders without adding apiAddress as an extra dep that would
  // cause unnecessary re-runs.
  const prevApiAddressRef = useRef<string>(apiAddress);

  useEffect(() => {
    if (!tokenId) {
      setPrice(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    // When the active API address changes, wipe the entire in-memory
    // cache so the new network's prices are fetched fresh.
    if (prevApiAddressRef.current !== apiAddress && apiAddress) {
      clearTokenPriceCache();
      prevApiAddressRef.current = apiAddress;
    }

    setIsLoading(true);
    setError(null);

    getTokenPrice(tokenId, ttlMs)
      .then((result: TokenPriceType | null) => {
        if (cancelled) return;
        setPrice(result?.price ?? null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setPrice(null);
        setIsLoading(false);
      });

    // Cleanup: mark in-flight request as stale if the effect re-runs
    // before the promise resolves (e.g. tokenId or apiAddress changed).
    return () => {
      cancelled = true;
    };
  }, [tokenId, apiAddress, ttlMs]);

  return { price, isLoading, error };
}
