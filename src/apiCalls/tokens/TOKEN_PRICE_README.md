# getTokenPrice / useGetTokenPrice

## Overview

`getTokenPrice` is an async function that fetches the current USD price for any MultiversX token from the network's Economics API endpoint (`/economics/token/{tokenId}/price`).

`useGetTokenPrice` is the companion React hook that wraps the function and exposes a `{ price, isLoading, error }` tuple for use in components.

---

## `getTokenPrice`

```ts
import { getTokenPrice } from 'apiCalls/tokens/getTokenPrice';

const result = await getTokenPrice('WEGLD-bd4d79');
// result: { price: 42.5, tokenId: 'WEGLD-bd4d79' } | null
```

### Caching

Results are stored in an in-memory TTL cache keyed by `${apiAddress}:${tokenId}`. The default TTL is **30 seconds** (`TOKEN_PRICE_CACHE_TTL_MS`).

The cache key includes the active API address so switching networks (mainnet → devnet) automatically results in a fresh request.

### Cache utilities

| Function                          | Description                                 |
| --------------------------------- | ------------------------------------------- |
| `clearTokenPriceCache()`          | Remove all entries from the cache           |
| `invalidateTokenPriceCacheEntry(apiAddress, tokenId)` | Remove a single entry     |
| `getTokenPriceCacheKey(apiAddress, tokenId)` | Compute the cache key string      |

---

## `useGetTokenPrice`

```tsx
import { useGetTokenPrice } from 'react/hooks/useGetTokenPrice';

function TokenPrice({ tokenId }: { tokenId: string }) {
  const { price, isLoading, error } = useGetTokenPrice(tokenId);

  if (isLoading) return <Spinner />;
  if (error)     return <p>Error: {error.message}</p>;
  return <p>${price?.toFixed(4)}</p>;
}
```

### Return type

```ts
interface UseGetTokenPriceReturnType {
  price: number | null;
  isLoading: boolean;
  error: Error | null;
}
```

### Network-change invalidation

The hook reads the active API address from the Zustand store via `useGetNetworkConfig`. When the address changes, `clearTokenPriceCache()` is called and a fresh request is issued automatically.

### Race-condition safety

If `tokenId` changes before an in-flight request resolves, the stale response is discarded by the effect cleanup function — the component always sees the price for the **current** `tokenId`.

---

## Constants

| Constant                   | Location                                    | Default |
| -------------------------- | ------------------------------------------- | ------- |
| `TOKEN_PRICE_CACHE_TTL_MS` | `src/constants/tokenPrice.constants.ts`     | 30 000 ms |
| `TOKEN_PRICE_API_PATH`     | `src/apiCalls/tokens/getTokenPrice.ts`      | `"economics/token"` |

---

## Testing

Tests live next to the source files:

- `src/apiCalls/tokens/tests/getTokenPrice.test.ts` — unit tests for the function (MSW-mocked API).
- `src/react/hooks/tests/useGetTokenPrice.test.ts` — unit tests for the hook.
