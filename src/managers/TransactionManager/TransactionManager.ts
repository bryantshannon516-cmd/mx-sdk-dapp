import { checkTransactionStatus } from 'methods/trackTransactions/helpers/checkTransactionStatus';
import { TransactionRetryManager } from 'managers/internal/TransactionRetryManager';
import { TransactionManagerInitConfigType } from './TransactionManager.types';

/**
 * TransactionManager
 *
 * Singleton-style object-literal manager responsible for:
 *  - Orchestrating transaction polling for pending sessions.
 *  - Delegating retry-with-backoff logic to TransactionRetryManager so that
 *    transient network failures (5xx, timeouts) are handled transparently
 *    without surfacing noise to the user.
 *  - Providing a stable public API used by DappProvider and trackTransactions.
 *
 * Retry behaviour
 * ---------------
 * Each call to `pollTransactionStatus` is wrapped in a retry loop managed by
 * `TransactionRetryManager`. If the polling call throws a transient error
 * (e.g. 503 Service Unavailable), the manager waits for an exponentially
 * growing delay before re-attempting, up to `maxRetries` times.
 *
 * After retries are exhausted the error propagates to the caller so that
 * `ToastManager` can display a permanent-failure toast — exactly the same
 * path as today's non-retried failures.
 *
 * Configuring retries
 * -------------------
 * Pass `retryConfig` to `TransactionManager.init()`:
 *
 * ```ts
 * TransactionManager.init({
 *   retryConfig: { maxRetries: 5, retryDelay: 500 },
 * });
 * ```
 *
 * Defaults: maxRetries = 3, retryDelay = 1 000 ms (doubles per attempt).
 */
const TransactionManager = (() => {
  // ─── Private state ────────────────────────────────────────────────────────

  /** Sessions currently being polled (sessionId → interval handle). */
  const _pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  /** Whether the manager has been initialised. */
  let _initialised = false;

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Wraps `checkTransactionStatus` for `sessionId` with retry logic.
   * On permanent failure (retries exhausted or non-transient error) the
   * thrown error is allowed to propagate so callers can react to it.
   */
  async function _pollWithRetry(sessionId: string): Promise<void> {
    await TransactionRetryManager.executeWithRetry(sessionId, async (id) => {
      await checkTransactionStatus({ sessionId: id });
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * Initialises the TransactionManager and its internal retry sub-manager.
     *
     * @param config.retryConfig - Optional retry settings.
     *   - `maxRetries`  (default 3)   — max transient-error retries per poll call.
     *   - `retryDelay`  (default 1000) — base delay in ms (doubles each attempt).
     */
    init(config: TransactionManagerInitConfigType = {}): void {
      TransactionRetryManager.init(config.retryConfig ?? {});
      _initialised = true;
    },

    /**
     * Begins polling for the given session at the specified interval.
     * Each poll tick is wrapped in the exponential-backoff retry loop.
     *
     * Calling `startPolling` for a session that is already being polled is a
     * no-op; the existing interval is preserved.
     *
     * @param sessionId      - The transaction session to poll.
     * @param intervalMs     - Polling interval in milliseconds.
     * @param onPermanentFailure - Optional callback invoked when retries are
     *                            exhausted and the error is propagated. Use
     *                            this hook to trigger failure toasts.
     */
    startPolling(
      sessionId: string,
      intervalMs: number,
      onPermanentFailure?: (sessionId: string, error: unknown) => void
    ): void {
      if (_pollingIntervals.has(sessionId)) {
        return; // Already polling — skip duplicate registration.
      }

      const handle = setInterval(async () => {
        try {
          await _pollWithRetry(sessionId);
        } catch (error: unknown) {
          // Retries exhausted or permanent error — stop polling and notify.
          this.stopPolling(sessionId);
          onPermanentFailure?.(sessionId, error);
        }
      }, intervalMs);

      _pollingIntervals.set(sessionId, handle);
    },

    /**
     * Stops polling for the given session and cancels any pending retry timer.
     */
    stopPolling(sessionId: string): void {
      const handle = _pollingIntervals.get(sessionId);
      if (handle != null) {
        clearInterval(handle);
        _pollingIntervals.delete(sessionId);
      }
      TransactionRetryManager.cancelRetry(sessionId);
    },

    /**
     * Stops all active polling sessions and cancels all pending retry timers.
     * Call this on logout or app teardown.
     */
    stopAllPolling(): void {
      for (const sessionId of _pollingIntervals.keys()) {
        this.stopPolling(sessionId);
      }
      TransactionRetryManager.cancelAllRetries();
    },

    /**
     * Returns `true` if the manager is currently polling for the given session.
     */
    isPolling(sessionId: string): boolean {
      return _pollingIntervals.has(sessionId);
    },

    /**
     * Registers lifecycle callbacks on the underlying retry manager.
     * Useful for wiring retry-state into UI / ToastManager feedback.
     *
     * @example
     * TransactionManager.registerRetryCallbacks({
     *   onRetrying: ({ sessionId, attempt, delayMs }) => {
     *     ToastManager.updateRetryingState(sessionId, attempt);
     *   },
     *   onRetryExhausted: ({ sessionId }) => {
     *     ToastManager.showPermanentFailure(sessionId);
     *   },
     * });
     */
    registerRetryCallbacks: TransactionRetryManager.registerCallbacks.bind(
      TransactionRetryManager
    ),

    /**
     * Exposes the underlying retry manager for advanced use-cases and testing.
     */
    retryManager: TransactionRetryManager,

    /**
     * Returns `true` if `init()` has been called.
     */
    isInitialised(): boolean {
      return _initialised;
    },

    /**
     * Resets internal state. Intended for use in tests between test cases.
     */
    reset(): void {
      this.stopAllPolling();
      TransactionRetryManager.reset();
      _initialised = false;
    }
  };
})();

export { TransactionManager };
