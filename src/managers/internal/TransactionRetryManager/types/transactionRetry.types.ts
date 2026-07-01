/**
 * Configuration options for the TransactionRetryManager.
 */
export type TransactionRetryConfigType = {
  /**
   * Maximum number of retry attempts before treating the failure as permanent.
   * Defaults to TRANSACTION_RETRY_MAX_RETRIES.
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds for the first retry attempt.
   * Each subsequent attempt doubles this value (exponential backoff).
   * Defaults to TRANSACTION_RETRY_BASE_DELAY_MS.
   */
  retryDelay?: number;
};

/**
 * Describes why a polling call failed — used to decide whether to retry.
 */
export type TransactionRetryErrorType = {
  /** HTTP status code, if the failure came from an HTTP response. */
  statusCode?: number;
  /** Raw error message string. */
  message?: string;
  /** Original thrown error/value, for inspection. */
  originalError?: unknown;
};

/**
 * Context object maintained per session while retries are in progress.
 */
export type TransactionRetrySessionStateType = {
  /** Number of retry attempts already performed for this session. */
  retryCount: number;
  /** Whether the session is currently in a retry back-off delay. */
  isRetrying: boolean;
  /** Timer handle for the pending retry, if any. */
  retryTimerId?: ReturnType<typeof setTimeout>;
};

/**
 * Callback invoked when a transient error is detected and a retry is scheduled.
 */
export type OnRetryingCallbackType = (params: {
  sessionId: string;
  attempt: number;
  delayMs: number;
  error: TransactionRetryErrorType;
}) => void;

/**
 * Callback invoked when a session's retries are exhausted without recovery.
 */
export type OnRetryExhaustedCallbackType = (params: {
  sessionId: string;
  totalAttempts: number;
  lastError: TransactionRetryErrorType;
}) => void;

/**
 * Callbacks that callers can register to observe retry lifecycle events.
 */
export type TransactionRetryCallbacksType = {
  onRetrying?: OnRetryingCallbackType;
  onRetryExhausted?: OnRetryExhaustedCallbackType;
};

/**
 * The shape of the function that actually performs the polling action
 * for a given session. The retry manager calls this on each attempt.
 */
export type TransactionPollingActionType = (
  sessionId: string
) => Promise<void>;
