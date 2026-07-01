import { isTransientError } from '../helpers/isTransientError';
import { TransactionRetryErrorType } from '../types';

describe('isTransientError', () => {
  describe('when a statusCode is present', () => {
    const transientCodes = [408, 429, 500, 502, 503, 504];
    const permanentCodes = [400, 401, 403, 404, 422];

    transientCodes.forEach((code) => {
      it(`should return true for HTTP ${code}`, () => {
        const error: TransactionRetryErrorType = { statusCode: code };
        expect(isTransientError(error)).toBe(true);
      });
    });

    permanentCodes.forEach((code) => {
      it(`should return false for HTTP ${code}`, () => {
        const error: TransactionRetryErrorType = { statusCode: code };
        expect(isTransientError(error)).toBe(false);
      });
    });
  });

  describe('when no statusCode is present but a message is', () => {
    const transientMessages = [
      'Network Error',
      'Request Timeout occurred',
      'ECONNRESET while connecting',
      'ECONNREFUSED to server',
      'socket hang up after delay',
      'ETIMEDOUT waiting for response',
      'Network Timeout reached'
    ];

    transientMessages.forEach((message) => {
      it(`should return true for message: "${message}"`, () => {
        const error: TransactionRetryErrorType = { message };
        expect(isTransientError(error)).toBe(true);
      });
    });

    it('should return false for a non-transient message', () => {
      const error: TransactionRetryErrorType = {
        message: 'Unauthorized: token expired'
      };
      expect(isTransientError(error)).toBe(false);
    });

    it('should be case-insensitive when matching messages', () => {
      expect(isTransientError({ message: 'NETWORK ERROR' })).toBe(true);
      expect(isTransientError({ message: 'network error' })).toBe(true);
      expect(isTransientError({ message: 'Network Error' })).toBe(true);
    });
  });

  describe('when neither statusCode nor message is present', () => {
    it('should return true (unknown errors treated as transient)', () => {
      expect(isTransientError({})).toBe(true);
    });
  });

  describe('when statusCode takes precedence over message', () => {
    it('should use statusCode and ignore message when both are present', () => {
      // statusCode 503 is transient, even though the message says "permanent"
      expect(
        isTransientError({ statusCode: 503, message: 'permanent error' })
      ).toBe(true);

      // statusCode 404 is permanent, even though the message says "network error"
      expect(
        isTransientError({ statusCode: 404, message: 'network error' })
      ).toBe(false);
    });
  });
});
