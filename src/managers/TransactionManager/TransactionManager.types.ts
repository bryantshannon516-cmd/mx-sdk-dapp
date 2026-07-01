import { TransactionRetryConfigType } from 'managers/internal/TransactionRetryManager';

export type TransactionManagerInitConfigType = {
  /**
   * Retry configuration for transient polling failures.
   * When omitted, the defaults from transactionRetry.constants.ts are used:
   *   - maxRetries: 3
   *   - retryDelay: 1000 ms (doubles per attempt — exponential backoff)
   */
  retryConfig?: TransactionRetryConfigType;
};
