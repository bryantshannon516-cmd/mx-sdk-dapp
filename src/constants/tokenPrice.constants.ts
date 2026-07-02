/**
 * Default TTL (in milliseconds) for the in-memory token price cache.
 *
 * Matches {@link TOKEN_PRICE_CACHE_TTL_MS} exported from
 * `apiCalls/tokens/getTokenPrice` and is re-exported here for consumers
 * that prefer to import from the constants layer.
 *
 * Value: **30 000 ms** (30 seconds).
 */
export const TOKEN_PRICE_CACHE_TTL_MS = 30_000;
