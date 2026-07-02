import { server, rest, testNetwork } from '__mocks__';
import { apiAddressSelector } from 'store/selectors/networkSelectors';
import { getState } from 'store/store';
import {
  clearTokenPriceCache,
  getTokenPrice,
  getTokenPriceCacheKey,
  invalidateTokenPriceCacheEntry,
  TOKEN_PRICE_CACHE_TTL_MS,
  TOKEN_PRICE_API_PATH,
  TokenPriceType
} from '../getTokenPrice';

jest.mock('store/store', () => ({
  getState: jest.fn()
}));

jest.mock('store/selectors/networkSelectors', () => ({
  apiAddressSelector: jest.fn()
}));

const TOKEN_ID = 'WEGLD-bd4d79';
const MOCK_PRICE = 42.5;

function buildPriceEndpoint(
  apiAddress: string = testNetwork.apiAddress,
  tokenId: string = TOKEN_ID
) {
  return `${apiAddress}/${TOKEN_PRICE_API_PATH}/${encodeURIComponent(tokenId)}/price`;
}

function setupMocks(apiAddress: string = testNetwork.apiAddress) {
  (getState as jest.Mock).mockReturnValue({
    network: { network: testNetwork }
  });
  (apiAddressSelector as jest.Mock).mockReturnValue(apiAddress);
}

describe('getTokenPrice', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearTokenPriceCache();
    setupMocks();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('fetches and returns the token price from the API', async () => {
    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ price: MOCK_PRICE }))
      )
    );

    const result = await getTokenPrice(TOKEN_ID);

    expect(result).not.toBeNull();
    expect(result).toEqual<TokenPriceType>({
      price: MOCK_PRICE,
      tokenId: TOKEN_ID
    });
  });

  // -------------------------------------------------------------------------
  // Guard: empty tokenId
  // -------------------------------------------------------------------------

  it('returns null when tokenId is an empty string', async () => {
    const result = await getTokenPrice('');
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cache: hit within TTL
  // -------------------------------------------------------------------------

  it('returns the cached value on a second call within TTL', async () => {
    let callCount = 0;

    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) => {
        callCount += 1;
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      })
    );

    await getTokenPrice(TOKEN_ID);
    const result = await getTokenPrice(TOKEN_ID);

    expect(callCount).toBe(1);
    expect(result?.price).toBe(MOCK_PRICE);
  });

  // -------------------------------------------------------------------------
  // Cache: miss after TTL expiry
  // -------------------------------------------------------------------------

  it('re-fetches after the TTL has elapsed', async () => {
    jest.useFakeTimers();

    let callCount = 0;

    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) => {
        callCount += 1;
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      })
    );

    await getTokenPrice(TOKEN_ID, TOKEN_PRICE_CACHE_TTL_MS);
    jest.advanceTimersByTime(TOKEN_PRICE_CACHE_TTL_MS + 1);
    await getTokenPrice(TOKEN_ID, TOKEN_PRICE_CACHE_TTL_MS);

    expect(callCount).toBe(2);

    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Cache: network change invalidates cache key
  // -------------------------------------------------------------------------

  it('invalidates the cache when the API address changes', async () => {
    const devnetApi = 'https://devnet-api.multiversx.com';

    let callCount = 0;

    server.use(
      rest.get(buildPriceEndpoint(testNetwork.apiAddress), (_req, res, ctx) => {
        callCount += 1;
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      }),
      rest.get(buildPriceEndpoint(devnetApi), (_req, res, ctx) => {
        callCount += 1;
        return res(ctx.status(200), ctx.json({ price: 1.23 }));
      })
    );

    // First call on mainnet
    await getTokenPrice(TOKEN_ID);

    // Switch network
    (apiAddressSelector as jest.Mock).mockReturnValue(devnetApi);
    const devnetResult = await getTokenPrice(TOKEN_ID);

    expect(callCount).toBe(2);
    expect(devnetResult?.price).toBe(1.23);
  });

  // -------------------------------------------------------------------------
  // Error: API returns non-2xx
  // -------------------------------------------------------------------------

  it('throws when the API returns an error status', async () => {
    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) =>
        res(ctx.status(404), ctx.json({ error: 'Not Found' }))
      )
    );

    await expect(getTokenPrice(TOKEN_ID)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Error: failed request is not cached
  // -------------------------------------------------------------------------

  it('does not cache a failed request', async () => {
    let callCount = 0;

    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) => {
        callCount += 1;
        if (callCount === 1) {
          return res(ctx.status(500), ctx.json({ error: 'Server Error' }));
        }
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      })
    );

    await expect(getTokenPrice(TOKEN_ID)).rejects.toThrow();

    const result = await getTokenPrice(TOKEN_ID);
    expect(callCount).toBe(2);
    expect(result?.price).toBe(MOCK_PRICE);
  });

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  it('generates a correct cache key from apiAddress and tokenId', () => {
    const key = getTokenPriceCacheKey(testNetwork.apiAddress, 'WEGLD-bd4d79');
    expect(key).toBe(`${testNetwork.apiAddress}:WEGLD-bd4d79`);
  });

  it('clearTokenPriceCache removes all entries and forces re-fetch', async () => {
    let callCount = 0;

    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) => {
        callCount += 1;
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      })
    );

    await getTokenPrice(TOKEN_ID);
    clearTokenPriceCache();
    await getTokenPrice(TOKEN_ID);

    expect(callCount).toBe(2);
  });

  it('invalidateTokenPriceCacheEntry removes only the targeted entry', async () => {
    const SECOND_TOKEN = 'USDC-c76f1f';
    let wegldCalls = 0;
    let usdcCalls = 0;

    server.use(
      rest.get(buildPriceEndpoint(testNetwork.apiAddress, TOKEN_ID), (_req, res, ctx) => {
        wegldCalls += 1;
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      }),
      rest.get(buildPriceEndpoint(testNetwork.apiAddress, SECOND_TOKEN), (_req, res, ctx) => {
        usdcCalls += 1;
        return res(ctx.status(200), ctx.json({ price: 1.0 }));
      })
    );

    // Populate cache for both tokens
    await getTokenPrice(TOKEN_ID);
    await getTokenPrice(SECOND_TOKEN);

    // Invalidate only WEGLD
    invalidateTokenPriceCacheEntry(testNetwork.apiAddress, TOKEN_ID);

    // WEGLD should be re-fetched; USDC should still come from cache
    await getTokenPrice(TOKEN_ID);
    await getTokenPrice(SECOND_TOKEN);

    expect(wegldCalls).toBe(2); // re-fetched after invalidation
    expect(usdcCalls).toBe(1); // still cached
  });
});
