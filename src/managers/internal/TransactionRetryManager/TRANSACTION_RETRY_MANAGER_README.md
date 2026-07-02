# TransactionRetryManager

An object-literal singleton that manages per-session transaction retry state with **exponential backoff** for transient failures.

## Architecture

`TransactionRetryManager` follows the same object-literal singleton pattern as `WalletConnectReconnectManager`.

It is responsible for:

- Tracking retry counts per transaction session ID (in-memory only).
- Scheduling delayed retry attempts using configurable exponential backoff.
- Distinguishing **transient errors** (network timeouts, temporary API unavailability) from **terminal errors** (invalid transactions, insufficient funds) — only transient errors trigger retries.
- Emitting named lifecycle events (`onRetrying`, `onRetrySucceeded`, `onRetryExhausted`) so the UI layer can reflect retry state without tight coupling.
- Clearing retry state on success, exhaustion, or explicit cancellation.

## Usage

```ts
import { TransactionRetryManager } from 'managers/internal/TransactionRetryManager';

// Schedule a retry for a session
TransactionRetryManager.scheduleRetry('session-123', async () => {
  await pollTransactionStatus('session-123');
});

// Listen for events
TransactionRetryManager.onRetrying = (sessionId, attempt) => {
  store.setRetrying(sessionId, attempt);
};
TransactionRetryManager.onRetryExhausted = (sessionId) => {
  store.setRetryFailed(sessionId);
};
```

## Constants

Retry configuration defaults live in `src/constants/transactionRetry.constants.ts`:

| Constant                        | Default | Description                          |
| ------------------------------- | ------- | ------------------------------------ |
| `TRANSACTION_RETRY_MAX_RETRIES` | `3`     | Maximum number of retry attempts     |
| `TRANSACTION_RETRY_BASE_DELAY_MS` | `1000` | Base delay in ms (doubled each time) |
| `TRANSACTION_RETRY_MAX_DELAY_MS`  | `8000` | Upper cap on backoff delay           |

## Related

- `src/react/hooks/useGetTransactionRetryState` — exposes retry state to React components.
- `src/managers/TransactionManager` — delegates retry scheduling to this manager.
