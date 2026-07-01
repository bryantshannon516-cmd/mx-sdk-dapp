import { TransactionRetryErrorType } from '../types';

/**
 * Normalises an unknown thrown value into a `TransactionRetryErrorType` so that
 * `isTransientError` and callbacks always receive a consistent shape.
 *
 * Handles:
 *  - Axios-style errors with `response.status` and `message`
 *  - Plain `Error` instances
 *  - Primitive strings thrown directly
 *  - Anything else (returns empty object — treated as unknown transient)
 */
export function extractRetryError(thrown: unknown): TransactionRetryErrorType {
  if (thrown == null) {
    return {};
  }

  if (typeof thrown === 'string') {
    return { message: thrown };
  }

  if (typeof thrown === 'object') {
    const err = thrown as Record<string, unknown>;

    // Axios-style error: err.response.status
    const statusCode =
      typeof err['response'] === 'object' && err['response'] != null
        ? (err['response'] as Record<string, unknown>)['status']
        : undefined;

    const message =
      typeof err['message'] === 'string' ? err['message'] : undefined;

    return {
      statusCode: typeof statusCode === 'number' ? statusCode : undefined,
      message,
      originalError: thrown
    };
  }

  return { originalError: thrown };
}
