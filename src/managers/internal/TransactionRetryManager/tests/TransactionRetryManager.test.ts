import {
  TRANSACTION_RETRY_BASE_DELAY_MS,
  TRANSACTION_RETRY_MAX_RETRIES
} from 'constants/transactionRetry.constants';
import { TransactionRetryManager } from '../TransactionRetryManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a mock action that succeeds after `failCount` transient 503 failures. */
function createFailingAction(failCount: number) {
  let callCount = 0;
  const action = jest.fn(async (_sessionId: string) => {
    callCount++;
    if (callCount <= failCount) {
      const err: Record<string, unknown> = {
        message: 'Request failed with status code 503',
        response: { status: 503 }
      };
      throw err;
    }
    // Succeeds on call number failCount + 1
  });
  return { action, getCallCount: () => callCount };
}

/** Creates a mock action that always fails with a permanent 400 error. */
function createPermanentFailAction() {
  const action = jest.fn(async (_sessionId: string) => {
    const err: Record<string, unknown> = {
      message: 'Request failed with status code 400',
      response: { status: 400 }
    };
    throw err;
  });
  return action;
}

/** Creates a mock action that always fails with a transient error. */
function createAlwaysTransientFailAction() {
  const action = jest.fn(async (_sessionId: string) => {
    const err: Record<string, unknown> = {
      message: 'Request failed with status code 503',
      response: { status: 503 }
    };
    throw err;
  });
  return action;
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('TransactionRetryManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    TransactionRetryManager.reset();
  });

  afterEach(() => {
    jest.useRealTimers();
    TransactionRetryManager.reset();
  });

  // ─── init() ────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('should use default constants when no config is provided', () => {
      TransactionRetryManager.init();
      expect(TransactionRetryManager.getMaxRetries()).toBe(
        TRANSACTION_RETRY_MAX_RETRIES
      );
      expect(TransactionRetryManager.getBaseDelayMs()).toBe(
        TRANSACTION_RETRY_BASE_DELAY_MS
      );
    });

    it('should apply provided maxRetries', () => {
      TransactionRetryManager.init({ maxRetries: 5 });
      expect(TransactionRetryManager.getMaxRetries()).toBe(5);
    });

    it('should apply provided retryDelay', () => {
      TransactionRetryManager.init({ retryDelay: 2000 });
      expect(TransactionRetryManager.getBaseDelayMs()).toBe(2000);
    });

    it('should apply both custom values simultaneously', () => {
      TransactionRetryManager.init({ maxRetries: 7, retryDelay: 500 });
      expect(TransactionRetryManager.getMaxRetries()).toBe(7);
      expect(TransactionRetryManager.getBaseDelayMs()).toBe(500);
    });
  });

  // ─── executeWithRetry() — happy path ───────────────────────────────────────

  describe('executeWithRetry() — success on first attempt', () => {
    it('should resolve without retrying when the action succeeds immediately', async () => {
      const action = jest.fn().mockResolvedValue(undefined);

      const promise = TransactionRetryManager.executeWithRetry(
        'session-1',
        action
      );
      await promise;

      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledWith('session-1');
    });

    it('should pass the sessionId to the action', async () => {
      const action = jest.fn().mockResolvedValue(undefined);
      await TransactionRetryManager.executeWithRetry('my-session', action);
      expect(action).toHaveBeenCalledWith('my-session');
    });

    it('should clear session state after success', async () => {
      const action = jest.fn().mockResolvedValue(undefined);
      await TransactionRetryManager.executeWithRetry('session-clean', action);
      expect(
        TransactionRetryManager.getSessionState('session-clean')
      ).toBeUndefined();
    });
  });

  // ─── executeWithRetry() — transient retry ──────────────────────────────────

  describe('executeWithRetry() — transient failures with eventual success', () => {
    it('should retry once on a 503 error and succeed on the second attempt', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 100 });
      const { action } = createFailingAction(1); // fail once, then succeed

      const promise = TransactionRetryManager.executeWithRetry(
        'session-retry-1',
        action
      );

      // Advance past the 1st backoff delay (100 ms * 2^0 = 100 ms)
      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(action).toHaveBeenCalledTimes(2);
    });

    it('should retry twice on consecutive 503 errors and succeed on the third attempt', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 100 });
      const { action } = createFailingAction(2); // fail twice, then succeed

      const promise = TransactionRetryManager.executeWithRetry(
        'session-retry-2',
        action
      );

      // 1st retry delay: 100 ms (2^0 * 100)
      await jest.advanceTimersByTimeAsync(100);
      // 2nd retry delay: 200 ms (2^1 * 100)
      await jest.advanceTimersByTimeAsync(200);
      await promise;

      expect(action).toHaveBeenCalledTimes(3);
    });

    it('should invoke onRetrying callback with correct metadata on each retry', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 1000 });
      const { action } = createFailingAction(2);

      const onRetrying = jest.fn();
      TransactionRetryManager.registerCallbacks({ onRetrying });

      const promise = TransactionRetryManager.executeWithRetry(
        'session-cb',
        action
      );

      // Advance through both retries
      await jest.advanceTimersByTimeAsync(1000); // 1st retry delay
      await jest.advanceTimersByTimeAsync(2000); // 2nd retry delay
      await promise;

      expect(onRetrying).toHaveBeenCalledTimes(2);

      // First retry: attempt=1, delayMs=1000
      expect(onRetrying).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sessionId: 'session-cb',
          attempt: 1,
          delayMs: 1000
        })
      );

      // Second retry: attempt=2, delayMs=2000
      expect(onRetrying).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sessionId: 'session-cb',
          attempt: 2,
          delayMs: 2000
        })
      );
    });

    it('should clear session state after eventual success', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 50 });
      const { action } = createFailingAction(1);

      const promise = TransactionRetryManager.executeWithRetry(
        'session-clear',
        action
      );
      await jest.advanceTimersByTimeAsync(50);
      await promise;

      expect(
        TransactionRetryManager.getSessionState('session-clear')
      ).toBeUndefined();
    });
  });

  // ─── executeWithRetry() — retries exhausted ────────────────────────────────

  describe('executeWithRetry() — retries exhausted', () => {
    it('should throw after maxRetries transient failures', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 100 });
      const action = createAlwaysTransientFailAction();

      const promise = TransactionRetryManager.executeWithRetry(
        'session-exhaust',
        action
      );

      // Advance through all 3 retry delays: 100, 200, 400
      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(200);
      await jest.advanceTimersByTimeAsync(400);

      await expect(promise).rejects.toBeDefined();
      // Initial attempt + 3 retries = 4 total calls
      expect(action).toHaveBeenCalledTimes(4);
    });

    it('should call onRetryExhausted callback when retries run out', async () => {
      TransactionRetryManager.init({ maxRetries: 2, retryDelay: 100 });
      const action = createAlwaysTransientFailAction();

      const onRetryExhausted = jest.fn();
      TransactionRetryManager.registerCallbacks({ onRetryExhausted });

      const promise = TransactionRetryManager.executeWithRetry(
        'session-exhausted-cb',
        action
      ).catch(() => {
        /* expected */
      });

      await jest.advanceTimersByTimeAsync(100); // 1st retry
      await jest.advanceTimersByTimeAsync(200); // 2nd retry (last)
      await promise;

      expect(onRetryExhausted).toHaveBeenCalledTimes(1);
      expect(onRetryExhausted).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-exhausted-cb',
          totalAttempts: 3 // initial + 2 retries
        })
      );
    });

    it('should clear session state after retries are exhausted', async () => {
      TransactionRetryManager.init({ maxRetries: 1, retryDelay: 50 });
      const action = createAlwaysTransientFailAction();

      const promise = TransactionRetryManager.executeWithRetry(
        'session-state-clear',
        action
      ).catch(() => {
        /* expected */
      });

      await jest.advanceTimersByTimeAsync(50);
      await promise;

      expect(
        TransactionRetryManager.getSessionState('session-state-clear')
      ).toBeUndefined();
    });
  });

  // ─── executeWithRetry() — permanent errors ─────────────────────────────────

  describe('executeWithRetry() — permanent (non-transient) errors', () => {
    it('should NOT retry a 400 error and should throw immediately', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 100 });
      const action = createPermanentFailAction();

      await expect(
        TransactionRetryManager.executeWithRetry('session-perm', action)
      ).rejects.toBeDefined();

      // No retries — only 1 call total
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should NOT invoke onRetrying for a permanent error', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 100 });
      const action = createPermanentFailAction();
      const onRetrying = jest.fn();
      TransactionRetryManager.registerCallbacks({ onRetrying });

      await TransactionRetryManager.executeWithRetry(
        'session-perm-cb',
        action
      ).catch(() => {
        /* expected */
      });

      expect(onRetrying).not.toHaveBeenCalled();
    });

    it('should NOT invoke onRetryExhausted for a permanent error', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 100 });
      const action = createPermanentFailAction();
      const onRetryExhausted = jest.fn();
      TransactionRetryManager.registerCallbacks({ onRetryExhausted });

      await TransactionRetryManager.executeWithRetry(
        'session-perm-exhaust',
        action
      ).catch(() => {
        /* expected */
      });

      expect(onRetryExhausted).not.toHaveBeenCalled();
    });
  });

  // ─── cancelRetry() ─────────────────────────────────────────────────────────

  describe('cancelRetry()', () => {
    it('should clear the session state for a given session', async () => {
      TransactionRetryManager.init({ maxRetries: 5, retryDelay: 10000 });
      const action = createAlwaysTransientFailAction();

      // Start the retry loop but do NOT advance timers — it will be mid-backoff.
      TransactionRetryManager.executeWithRetry('session-cancel', action).catch(
        () => {
          /* swallow */
        }
      );

      // After the first failure, state should exist
      await Promise.resolve(); // let the microtask queue flush the first failure

      TransactionRetryManager.cancelRetry('session-cancel');

      expect(
        TransactionRetryManager.getSessionState('session-cancel')
      ).toBeUndefined();
    });

    it('should be a no-op for a session with no active state', () => {
      expect(() =>
        TransactionRetryManager.cancelRetry('non-existent')
      ).not.toThrow();
    });
  });

  // ─── cancelAllRetries() ────────────────────────────────────────────────────

  describe('cancelAllRetries()', () => {
    it('should clear all session states', async () => {
      TransactionRetryManager.init({ maxRetries: 5, retryDelay: 10000 });
      const action = createAlwaysTransientFailAction();

      TransactionRetryManager.executeWithRetry('s1', action).catch(() => {});
      TransactionRetryManager.executeWithRetry('s2', action).catch(() => {});

      await Promise.resolve(); // flush first failures

      TransactionRetryManager.cancelAllRetries();

      expect(TransactionRetryManager.getSessionState('s1')).toBeUndefined();
      expect(TransactionRetryManager.getSessionState('s2')).toBeUndefined();
    });
  });

  // ─── reset() ───────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('should restore default config values', () => {
      TransactionRetryManager.init({ maxRetries: 99, retryDelay: 9999 });
      TransactionRetryManager.reset();
      expect(TransactionRetryManager.getMaxRetries()).toBe(
        TRANSACTION_RETRY_MAX_RETRIES
      );
      expect(TransactionRetryManager.getBaseDelayMs()).toBe(
        TRANSACTION_RETRY_BASE_DELAY_MS
      );
    });

    it('should clear callbacks', async () => {
      const onRetrying = jest.fn();
      TransactionRetryManager.registerCallbacks({ onRetrying });
      TransactionRetryManager.reset();

      // After reset, the callback should no longer fire
      TransactionRetryManager.init({ maxRetries: 1, retryDelay: 50 });
      const { action } = createFailingAction(1);

      const promise = TransactionRetryManager.executeWithRetry(
        'session-after-reset',
        action
      );
      await jest.advanceTimersByTimeAsync(50);
      await promise;

      expect(onRetrying).not.toHaveBeenCalled();
    });
  });

  // ─── Exponential backoff verification ──────────────────────────────────────

  describe('exponential backoff delays', () => {
    it('should apply correct backoff: 1s, 2s, 4s for baseDelay=1000', async () => {
      TransactionRetryManager.init({ maxRetries: 3, retryDelay: 1000 });
      const action = createAlwaysTransientFailAction();
      const onRetrying = jest.fn();
      TransactionRetryManager.registerCallbacks({ onRetrying });

      const promise = TransactionRetryManager.executeWithRetry(
        'session-backoff',
        action
      ).catch(() => {
        /* expected */
      });

      // Retry 1: delay 1000ms
      await jest.advanceTimersByTimeAsync(999);
      expect(onRetrying).toHaveBeenCalledTimes(1); // fired before first delay
      await jest.advanceTimersByTimeAsync(1);

      // Retry 2: delay 2000ms
      await jest.advanceTimersByTimeAsync(1999);
      await jest.advanceTimersByTimeAsync(1);

      // Retry 3: delay 4000ms
      await jest.advanceTimersByTimeAsync(3999);
      await jest.advanceTimersByTimeAsync(1);

      await promise;

      // Verify the three delay values reported to the callback
      const delays = onRetrying.mock.calls.map((call) => call[0].delayMs);
      expect(delays).toEqual([1000, 2000, 4000]);
    });
  });
});
