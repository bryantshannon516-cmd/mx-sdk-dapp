/**
 * Computes the exponential backoff delay for a given retry attempt.
 *
 * Formula: baseDelayMs * 2^attemptIndex
 *
 * @param baseDelayMs  - The delay used for the very first retry (attempt 0).
 * @param attemptIndex - Zero-based index of the retry attempt (0 = first retry).
 * @returns Delay in milliseconds that the caller should wait before the next attempt.
 *
 * @example
 * computeBackoffDelay(1000, 0) // → 1000  (1st retry: 1 s)
 * computeBackoffDelay(1000, 1) // → 2000  (2nd retry: 2 s)
 * computeBackoffDelay(1000, 2) // → 4000  (3rd retry: 4 s)
 */
export function computeBackoffDelay(
  baseDelayMs: number,
  attemptIndex: number
): number {
  return baseDelayMs * Math.pow(2, attemptIndex);
}
