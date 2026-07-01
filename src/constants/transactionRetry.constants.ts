/**
 * Default maximum number of retry attempts for transient transaction polling failures.
 * After this many retries the manager emits a permanent failure and stops retrying.
 */
export const TRANSACTION_RETRY_MAX_RETRIES = 3;

/**
 * Base delay in milliseconds for the first retry attempt.
 * Each subsequent attempt doubles this value (exponential backoff).
 */
export const TRANSACTION_RETRY_BASE_DELAY_MS = 1000;

/**
 * HTTP status codes that are considered transient and should trigger a retry.
 */
export const TRANSACTION_RETRY_TRANSIENT_STATUS_CODES: number[] = [
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504 // Gateway Timeout
];

/**
 * Error message substrings that are considered transient network issues
 * and should trigger a retry (when no HTTP status code is available).
 */
export const TRANSACTION_RETRY_TRANSIENT_ERROR_SUBSTRINGS: string[] = [
  'network error',
  'timeout',
  'econnreset',
  'econnrefused',
  'socket hang up',
  'etimedout',
  'network timeout'
];
