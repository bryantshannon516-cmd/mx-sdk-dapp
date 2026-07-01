import {
  TRANSACTION_RETRY_BASE_DELAY_MS,
  TRANSACTION_RETRY_MAX_RETRIES
} from 'constants/transactionRetry.constants';
import { computeBackoffDelay } from './helpers/computeBackoffDelay';
import { extractRetryError } from './helpers/extractRetryError';
import { isTransientError } from './helpers/isTransientError';
import {
  OnRetryExhaustedCallbackType,
  OnRetryingCallbackType,
  TransactionPollingActionType,
  TransactionRetryCallbacksType,
  TransactionRetryConfigType,
  TransactionRetryErrorType,
  TransactionRetrySessionStateType
} from './types';

/**
 * TransactionRetryManager
 *
 * An internal singleton-style manager (object-literal pattern) that wraps
 * any asynchronous transaction-polling action with exponential-backoff retry
 * logic for transient failures.
 *
 * Responsibilities:
 *  - Tracking per-session retry state (attempt count, pending timer).
 *  - Deciding whether a thrown error is transient (retryable) or permanent.
 *  - Scheduling the next attempt after an exponentially growing delay.
 *  - Calling registered lifecycle callbacks so the UI layer or ToastManager
 *    can reflect retry state without coupling to retry internals.
 *  - Cleaning up per-session state on success, permanent failure, or cancellation.
 *
 * Usage:
 * ```ts
 * TransactionRetryManager.init({ maxRetries: 3, retryDelay: 1000 });
 *
 * TransactionRetryManager.registerCallbacks({
 *   onRetrying: ({ sessionId, attempt, delayMs }) => { ... },
 *   onRetryExhausted: ({ sessionId, totalAttempts }) => { ... },
 * });
 *
 * await TransactionRetryManager.executeWithRetry(
 *   'session-abc',
 *   (sessionId) => checkTransactionStatus(sessionId),
 * );
 * ```
 */
const TransactionRetryManager = (() => {
  // ─── Private state ───────────────────────────────────────────────────────

  let _maxRetries: number = TRANSACTION_RETRY_MAX_RETRIES;
  let _baseDelayMs: number = TRANSACTION_RETRY_BASE_DELAY_MS;

  /** Per-session retry state keyed by sessionId. */
  const _sessionStates = new Map<string, TransactionRetrySessionStateType>();

  let _onRetrying: OnRetryingCallbackType | undefined;
  let _onRetryExhausted: OnRetryExhaustedCallbackType | undefined;

  // ─── Private helpers ─────────────────────────────────────────────────────

  function _getOrCreateSessionState(
    sessionId: string
  ): TransactionRetrySessionStateType {
    if (!_sessionStates.has(sessionId)) {
      _sessionStates.set(sessionId, { retryCount: 0, isRetrying: false });
    }
    return _sessionStates.get(sessionId)!;
  }

  function _clearSessionState(sessionId: string): void {
    const state = _sessionStates.get(sessionId);
    if (state?.retryTimerId != null) {
      clearTimeout(state.retryTimerId);
    }
    _sessionStates.delete(sessionId);
  }

  /**
   * Core recursive retry loop. Each call represents one polling attempt.
   * On success it resolves; on permanent failure or exhaustion it rejects.
   */
  async function _attempt(
    sessionId: string,
    action: TransactionPollingActionType,
    attemptIndex: number
  ): Promise<void> {
    const state = _getOrCreateSessionState(sessionId);

    try {
      await action(sessionId);
      // ✓ Success — clean up retry state
      _clearSessionState(sessionId);
    } catch (thrown: unknown) {
      const retryError: TransactionRetryErrorType = extractRetryError(thrown);
      const transient = isTransientError(retryError);

      if (!transient || attemptIndex >= _maxRetries) {
        // Permanent failure: either not a transient error or retries exhausted.
        const totalAttempts = attemptIndex + 1;

        if (transient && attemptIndex >= _maxRetries) {
          _onRetryExhausted?.({
            sessionId,
            totalAttempts,
            lastError: retryError
          });
        }

        _clearSessionState(sessionId);
        throw thrown; // Re-throw so callers can handle permanent failures.
      }

      // Transient failure within retry budget — schedule the next attempt.
      const delayMs = computeBackoffDelay(_baseDelayMs, attemptIndex);

      state.retryCount = attemptIndex + 1;
      state.isRetrying = true;

      _onRetrying?.({
        sessionId,
        attempt: state.retryCount,
        delayMs,
        error: retryError
      });

      await new Promise<void>((resolve) => {
        const timerId = setTimeout(() => {
          state.retryTimerId = undefined;
          resolve();
        }, delayMs);
        state.retryTimerId = timerId;
      });

      state.isRetrying = false;
      return _attempt(sessionId, action, attemptIndex + 1);
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * Configures the retry manager. Call once during TransactionManager.init().
     */
    init(config: TransactionRetryConfigType = {}): void {
      _maxRetries = config.maxRetries ?? TRANSACTION_RETRY_MAX_RETRIES;
      _baseDelayMs = config.retryDelay ?? TRANSACTION_RETRY_BASE_DELAY_MS;
    },

    /**
     * Registers lifecycle event callbacks.
     * Subsequent calls overwrite previous registrations.
     */
    registerCallbacks(callbacks: TransactionRetryCallbacksType): void {
      _onRetrying = callbacks.onRetrying;
      _onRetryExhausted = callbacks.onRetryExhausted;
    },

    /**
     * Executes `action` for `sessionId` with automatic exponential-backoff
     * retry on transient failures.
     *
     * @param sessionId - The transaction session identifier, used as the key
     *                    for tracking per-session retry state.
     * @param action    - Async function that performs the actual polling call.
     *                    Receives `sessionId` and should throw on failure.
     *
     * @throws The last error if retries are exhausted or the error is permanent.
     */
    async executeWithRetry(
      sessionId: string,
      action: TransactionPollingActionType
    ): Promise<void> {
      return _attempt(sessionId, action, 0);
    },

    /**
     * Cancels any pending retry timer for the given session and removes its state.
     * Call this when a session is explicitly cancelled (e.g. logout, user navigation).
     */
    cancelRetry(sessionId: string): void {
      _clearSessionState(sessionId);
    },

    /**
     * Cancels all active retries. Useful for global cleanup on logout.
     */
    cancelAllRetries(): void {
      for (const sessionId of _sessionStates.keys()) {
        _clearSessionState(sessionId);
      }
    },

    /**
     * Returns a snapshot of the current retry state for a session.
     * Primarily intended for testing and debugging.
     */
    getSessionState(
      sessionId: string
    ): Readonly<TransactionRetrySessionStateType> | undefined {
      return _sessionStates.get(sessionId);
    },

    /**
     * Returns the currently configured max-retries value.
     * Primarily intended for testing.
     */
    getMaxRetries(): number {
      return _maxRetries;
    },

    /**
     * Returns the currently configured base-delay value in ms.
     * Primarily intended for testing.
     */
    getBaseDelayMs(): number {
      return _baseDelayMs;
    },

    /**
     * Resets the manager to its default configuration and clears all state.
     * Primarily intended for use in tests between test cases.
     */
    reset(): void {
      _maxRetries = TRANSACTION_RETRY_MAX_RETRIES;
      _baseDelayMs = TRANSACTION_RETRY_BASE_DELAY_MS;
      _onRetrying = undefined;
      _onRetryExhausted = undefined;
      for (const sessionId of _sessionStates.keys()) {
        _clearSessionState(sessionId);
      }
    }
  };
})();

export { TransactionRetryManager };
