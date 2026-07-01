# TransactionRetryManager

An internal singleton-style manager (object-literal pattern) that wraps any asynchronous transaction-polling action with **exponential-backoff retry** logic for transient network failures.

---

## Why it exists

Transaction polling calls (`checkTransactionStatus`) can fail intermittently due to:

- Short-lived API outages (503 Service Unavailable)
- Network congestion / gateway timeouts (502, 504)
- Rate-limiting (429 Too Many Requests)
- Client-side flakiness (ECONNRESET, ETIMEDOUT, socket hang up)

Without retries, a single dropped packet causes a permanent-failure toast even though the user's transaction completed successfully on-chain. `TransactionRetryManager` absorbs these transient blips transparently.

---

## Architecture

```
TransactionManager
    └── executeWithRetry(sessionId, action)
            └── TransactionRetryManager._attempt()
                    ├── action(sessionId)          ← actual polling call
                    ├── isTransientError()         ← decide to retry or re-throw
                    ├── computeBackoffDelay()      ← 1s → 2s → 4s …
                    └── setTimeout → recurse
```

The manager is an **IIFE-returned object literal** (same pattern as `NotificationsFeedManager`) — there is no class and no `new` keyword. All state is private to the closure.

---

## Retry logic

| Attempt | Delay before next call |
|---------|------------------------|
| 0       | (immediate — first try) |
| 1       | `baseDelayMs × 2⁰`     |
| 2       | `baseDelayMs × 2¹`     |
| 3       | `baseDelayMs × 2²`     |
| …       | …                      |

Default values (from `src/constants/transactionRetry.constants.ts`):

- `maxRetries`: **3**
- `baseDelayMs`: **1 000 ms**

Resulting delays with defaults: **1 s → 2 s → 4 s** (total extra wait ≤ 7 s).

---

## Transient vs permanent errors

| Condition | Retried? |
|-----------|----------|
| HTTP 408, 429, 500, 502, 503, 504 | ✅ Yes |
| Message contains "network error", "timeout", "econnreset", … | ✅ Yes |
| Unknown error (no code, no message) | ✅ Yes (fail-safe) |
| HTTP 400, 401, 403, 404, 422, … | ❌ No — propagated immediately |

---

## Configuration

```ts
// In TransactionManager.init() or standalone:
TransactionRetryManager.init({
  maxRetries: 5,    // override default of 3
  retryDelay: 500,  // base delay in ms; default 1000
});
```

---

## Lifecycle callbacks

```ts
TransactionRetryManager.registerCallbacks({
  onRetrying: ({ sessionId, attempt, delayMs, error }) => {
    // e.g. update a "Retrying…" toast
  },
  onRetryExhausted: ({ sessionId, totalAttempts, lastError }) => {
    // e.g. show permanent-failure toast
  },
});
```

---

## Session management

Each `sessionId` has isolated retry state. You can:

- `cancelRetry(sessionId)` — cancel a specific session's pending timer.
- `cancelAllRetries()` — cancel all pending timers (use on logout).
- `getSessionState(sessionId)` — inspect retry count (testing / debugging).

---

## Files

```
TransactionRetryManager/
├── TransactionRetryManager.ts          ← main manager (singleton object literal)
├── index.ts                            ← barrel export
├── TRANSACTION_RETRY_MANAGER_README.md ← this file
├── helpers/
│   ├── computeBackoffDelay.ts          ← baseDelayMs * 2^attemptIndex
│   ├── extractRetryError.ts            ← normalises unknown thrown → RetryErrorType
│   └── isTransientError.ts             ← decides retry vs propagate
└── tests/
    ├── TransactionRetryManager.test.ts ← full retry lifecycle tests
    ├── computeBackoffDelay.test.ts
    ├── extractRetryError.test.ts
    └── isTransientError.test.ts
```
