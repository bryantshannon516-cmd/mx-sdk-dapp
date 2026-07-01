import {
  TRANSACTION_RETRY_TRANSIENT_ERROR_SUBSTRINGS,
  TRANSACTION_RETRY_TRANSIENT_STATUS_CODES
} from 'constants/transactionRetry.constants';
import { TransactionRetryErrorType } from '../types';

/**
 * Determines whether a given error represents a transient (retryable) failure.
 *
 * An error is considered transient when:
 *  - Its HTTP status code appears in the configured list of retryable codes, OR
 *  - Its message contains a known transient network-error substring (case-insensitive).
 *
 * Permanent errors (e.g. 400 Bad Request, 404 Not Found) return `false` so
 * the manager propagates them immediately without burning retry attempts.
 */
export function isTransientError(error: TransactionRetryErrorType): boolean {
  const { statusCode, message } = error;

  if (statusCode != null) {
    return TRANSACTION_RETRY_TRANSIENT_STATUS_CODES.includes(statusCode);
  }

  if (message != null) {
    const lowerMessage = message.toLowerCase();
    return TRANSACTION_RETRY_TRANSIENT_ERROR_SUBSTRINGS.some((substring) =>
      lowerMessage.includes(substring)
    );
  }

  // Unknown errors without a code or message are treated as transient so we
  // give the network at least one chance to recover.
  return true;
}
