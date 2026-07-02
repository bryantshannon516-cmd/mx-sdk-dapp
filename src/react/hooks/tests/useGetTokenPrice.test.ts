import { renderHook, act, waitFor } from '@testing-library/react';
import { server, rest, testNetwork } from '__mocks__';
import {
  clearTokenPriceCache,
  TOKEN_PRICE_CACHE_TTL_MS,
  TOKEN_PRICE_API_PATH
} from 'apiCalls/tokens/getTokenPrice';
import { useGetNetworkConfig } from 'react/hooks/useGetNetworkConfig';
import { useGetTokenPrice } from '../useGetTokenPrice';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('react/hooks/useGetNetworkConfig', () => ({
  useGetNetworkConfig: jest.fn()
}));

const mockUseGetNetworkConfig = useGetNetworkConfig as jest.Mock;

function setupNetworkConfig(apiAddress: string = testNetwork.apiAddress) {
  mockUseGetNetworkConfig.mockReturnValue({
    network: { ...testNetwork, apiAddress }
  });
}

// ---------------------------------------------------------------------------
// MSW helpers
// ---------------------------------------------------------------------------

const TOKEN_ID = 'WEGLD-bd4d79';
const MOCK_PRICE = 42.5;

function buildPriceEndpoint(
  tokenId: string = TOKEN_ID,
  apiAddress: string = testNetwork.apiAddress
) {
  return `${apiAddress}/${TOKEN_PRICE_API_PATH}/${encodeURIComponent(tokenId)}/price`;
}

function registerPriceHandler(
  price: number = MOCK_PRICE,
  tokenId: string = TOKEN_ID,
  apiAddress: string = testNetwork.apiAddress
) {
  server.use(
    rest.get(buildPriceEndpoint(tokenId, apiAddress), (_req, res, ctx) =>
      res(ctx.status(200), ctx.json({ price }))
    )
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGetTokenPrice', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearTokenPriceCache();
    setupNetworkConfig();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  // -------------------------------------------------------------------------
  // Initial loading state → resolved price
  // -------------------------------------------------------------------------

  it('starts with isLoading=true and resolves the price', async () => {
    registerPriceHandler();

    const { result } = renderHook(() => useGetTokenPrice(TOKEN_ID));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.price).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.price).toBe(MOCK_PRICE);
    expect(result.current.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Empty tokenId guard
  // -------------------------------------------------------------------------

  it('returns price=null and isLoading=false when tokenId is empty', () => {
    const { result } = renderHook(() => useGetTokenPrice(''));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.price).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  it('sets error and clears price on API failure', async () => {
    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) =>
        res(ctx.status(500), ctx.json({ error: 'Internal Server Error' }))
      )
    );

    const { result } = renderHook(() => useGetTokenPrice(TOKEN_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.price).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // -------------------------------------------------------------------------
  // tokenId change → re-fetch
  // -------------------------------------------------------------------------

  it('re-fetches when tokenId changes', async () => {
    const SECOND_TOKEN_ID = 'USDC-c76f1f';
    const SECOND_PRICE = 1.0;

    server.use(
      rest.get(buildPriceEndpoint(TOKEN_ID), (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ price: MOCK_PRICE }))
      ),
      rest.get(buildPriceEndpoint(SECOND_TOKEN_ID), (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ price: SECOND_PRICE }))
      )
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useGetTokenPrice(id),
      { initialProps: { id: TOKEN_ID } }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.price).toBe(MOCK_PRICE);

    rerender({ id: SECOND_TOKEN_ID });

    await waitFor(() => expect(result.current.price).toBe(SECOND_PRICE));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Network switch → cache cleared → re-fetch
  // -------------------------------------------------------------------------

  it('re-fetches when the network API address changes', async () => {
    const DEVNET_API = 'https://devnet-api.multiversx.com';
    const DEVNET_PRICE = 38.0;

    server.use(
      rest.get(
        buildPriceEndpoint(TOKEN_ID, testNetwork.apiAddress),
        (_req, res, ctx) =>
          res(ctx.status(200), ctx.json({ price: MOCK_PRICE }))
      ),
      rest.get(
        buildPriceEndpoint(TOKEN_ID, DEVNET_API),
        (_req, res, ctx) =>
          res(ctx.status(200), ctx.json({ price: DEVNET_PRICE }))
      )
    );

    const { result, rerender } = renderHook(() => useGetTokenPrice(TOKEN_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.price).toBe(MOCK_PRICE);

    act(() => {
      mockUseGetNetworkConfig.mockReturnValue({
        network: { ...testNetwork, apiAddress: DEVNET_API }
      });
    });

    rerender();

    await waitFor(() => expect(result.current.price).toBe(DEVNET_PRICE));
    expect(result.current.isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Cache hit: second hook instance reuses cached price
  // -------------------------------------------------------------------------

  it('uses the cached value without making a second network call', async () => {
    let callCount = 0;

    server.use(
      rest.get(buildPriceEndpoint(), (_req, res, ctx) => {
        callCount += 1;
        return res(ctx.status(200), ctx.json({ price: MOCK_PRICE }));
      })
    );

    const { result: result1 } = renderHook(() =>
      useGetTokenPrice(TOKEN_ID, TOKEN_PRICE_CACHE_TTL_MS)
    );
    await waitFor(() => expect(result1.current.isLoading).toBe(false));

    const { result: result2 } = renderHook(() =>
      useGetTokenPrice(TOKEN_ID, TOKEN_PRICE_CACHE_TTL_MS)
    );
    await waitFor(() => expect(result2.current.isLoading).toBe(false));

    expect(callCount).toBe(1);
    expect(result2.current.price).toBe(MOCK_PRICE);
  });

  // -------------------------------------------------------------------------
  // Race condition: cancelled effect on fast tokenId changes
  // -------------------------------------------------------------------------

  it('ignores stale responses when tokenId changes before the first request resolves', async () => {
    const SLOW_TOKEN = 'SLOW-000000';
    const FAST_TOKEN = 'FAST-111111';

    server.use(
      rest.get(
        buildPriceEndpoint(SLOW_TOKEN),
        async (_req, res, ctx) => {
          // Simulate a delayed response
          await new Promise((resolve) => setTimeout(resolve, 200));
          return res(ctx.status(200), ctx.json({ price: 99 }));
        }
      ),
      rest.get(
        buildPriceEndpoint(FAST_TOKEN),
        (_req, res, ctx) =>
          res(ctx.status(200), ctx.json({ price: 1 }))
      )
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useGetTokenPrice(id),
      { initialProps: { id: SLOW_TOKEN } }
    );

    // Switch token before the slow request completes
    rerender({ id: FAST_TOKEN });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Final state must reflect the FAST token, not the stale SLOW response
    expect(result.current.price).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Error recovery: switching back from an errored tokenId
  // -------------------------------------------------------------------------

  it('clears the error when tokenId changes after a failed request', async () => {
    const GOOD_TOKEN = 'GOOD-aaaaaa';

    server.use(
      // First token returns an error
      rest.get(buildPriceEndpoint(TOKEN_ID), (_req, res, ctx) =>
        res(ctx.status(404), ctx.json({ error: 'Not Found' }))
      ),
      // Second token succeeds
      rest.get(buildPriceEndpoint(GOOD_TOKEN), (_req, res, ctx) =>
        res(ctx.status(200), ctx.json({ price: 5.5 }))
      )
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useGetTokenPrice(id),
      { initialProps: { id: TOKEN_ID } }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).not.toBeNull();

    rerender({ id: GOOD_TOKEN });

    await waitFor(() => expect(result.current.price).toBe(5.5));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
