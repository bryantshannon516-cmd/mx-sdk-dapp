import axios from 'axios';
import { apiAddressSelector } from 'store/selectors/networkSelectors';
import { getState } from 'store/store';

/** The API path segment used to query token prices. */
export const TOKEN_PRICE_API_PATH = 'economics/token';

export interface TokenPriceType {
  price: number;
  tokenId: string;
}

interface TokenPriceCacheEntry {
  price: number;
  tokenId: string;
  timestamp: number;
  apiAddress: string;
}

/**
 * In-memory TTL cache keyed by `${apiAddress}:${tokenId}`.
 * Entries are invalidated when they exceed the TTL or when the
 * network's API address changes.
 */
const tokenPriceCache = new Map<string, TokenPriceCacheEntry>();

/** Default cache TTL: 30 seconds. */
export const TOKEN_PRICE_CACHE_TTL_MS = 30_000;

/**
 * Returns the cache key for a given apiAddress + tokenId pair.
 */
export function getTokenPriceCacheKey(
  apiAddress: string,
  tokenId: string
): string {
  return `${apiAddress}:${tokenId}`;
}

/**
 * Clears all cached token prices.
 * Useful for testing or explicit cache invalidation on network change.
 */
export function clearTokenPriceCache(): void {
  tokenPriceCache.clear();
}

/**
 * Removes a single token price entry from the cache.
 */
export function invalidateTokenPriceCacheEntry(
  apiAddress: string,
  tokenId: string
): void {
  tokenPriceCache.delete(getTokenPriceCacheKey(apiAddress, tokenId));
}

/**
 * Fetches the current USD price for a given token ID from the
 * MultiversX API (`/economics/token/{tokenId}/price`).
 *
 * Results are cached in memory for `ttlMs` milliseconds (default 30 s).
 * The cache is scoped to the active network's API address so that
 * switching networks (e.g. mainnet → devnet) always triggers a fresh
 * request.
 *
 * @param tokenId - The token identifier, e.g. `"WEGLD-bd4d79"`.
 * @param ttlMs   - Optional TTL override in milliseconds.
 * @returns       The resolved {@link TokenPriceType} or `null` when the
 *                token has no price data or `tokenId` is empty.
 */
export async function getTokenPrice(
  tokenId: string,
  ttlMs: number = TOKEN_PRICE_CACHE_TTL_MS
): Promise<TokenPriceType | null> {
  if (!tokenId) {
    return null;
  }

  const apiAddress = apiAddressSelector(getState());
  const cacheKey = getTokenPriceCacheKey(apiAddress, tokenId);
  const now = Date.now();

  const cached = tokenPriceCache.get(cacheKey);
  if (
    cached !== undefined &&
    cached.apiAddress === apiAddress &&
    now - cached.timestamp < ttlMs
  ) {
    return { price: cached.price, tokenId: cached.tokenId };
  }

  const { data } = await axios.get<{ price: number }>(
    `${apiAddress}/${TOKEN_PRICE_API_PATH}/${encodeURIComponent(tokenId)}/price`
  );

  const entry: TokenPriceCacheEntry = {
    price: data.price,
    tokenId,
    timestamp: now,
    apiAddress
  };

  tokenPriceCache.set(cacheKey, entry);

  return { price: entry.price, tokenId: entry.tokenId };
}
