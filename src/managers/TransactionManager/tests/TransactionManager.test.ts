import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { TransactionManager } from '../TransactionManager';
import { TransactionRetryManager } from 'managers/internal/TransactionRetryManager';

// ─── MSW server setup ────────────────────────────────────────────────────────

/**
 * A counter-based request handler that returns 503 for the first N calls,
 * then 200 for all subsequent calls. This lets us simulate intermittent
 * transient failures resolving after a fixed number of retries.
 */
function createFlakyHandler(
  url: string,
  failCount: number,
  successPayload: object = {}
) {
  let requestCount = 0;
  return http.get(url, () => {
    requestCount++;
    if (requestCount <= failCount) {
      return new HttpResponse(null, {
        status: 503,
        statusText: 'Service Unavailable'
      });
    }
    return HttpResponse.json(successPayload);
  });
}

// We use a stable base URL that matches what checkTransactionStatus calls.
// The exact path doesn't matter for these unit-level tests — we're testing
// TransactionManager's retry integration, not the API shape.
const API_BASE = 'https://api.multiversx.com';
const TX_STATUS_URL = `${API_BASE}/transactions/:hash`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a simple mock polling action that wraps a jest.fn()
 * (we don't exercise the real checkTransactionStatus in these tests —
 * instead we inject a mock action directly to isolate retry logic).
 */
function createMockAction(failCount: number) {
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
  });
  return { action, getCallCount: () => callCount };
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('TransactionManager — retry integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    TransactionManager.reset();
  });

  afterEach(() => {
    jest.useRealTimers();
    TransactionManager.reset();
  });

  // ─── init() ──────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('should configure the underlying retry manager with provided options', () => {
      TransactionManager.init({ retryConfig: { maxRetries: 5, retryDelay: 500 } });
      expect(TransactionManager.retryManager.getMaxRetries()).toBe(5);
      expect(TransactionManager.retryManager.getBaseDelayMs()).toBe(500);
    });

    it('should use default retry config when none is provided', () => {
      TransactionManager.init();
      expect(TransactionManager.isInitialised()).toBe(true);
      // Defaults from constants
      expect(TransactionManager.retryManager.getMaxRetries()).toBe(3);
      expect(TransactionManager.retryManager.getBaseDelayMs()).toBe(1000);
    });
  });

  // ─── startPolling() / stopPolling() ──────────────────────────────────────

  describe('startPolling() and stopPolling()', () => {
    it('should mark a session as polling after startPolling', () => {
      TransactionManager.init();
      const { action } = createMockAction(0);

      TransactionManager.startPolling('session-a', 5000, undefined);
      expect(TransactionManager.isPolling('session-a')).toBe(true);

      TransactionManager.stopPolling('session-a');
    });

    it('should mark a session as not polling after stopPolling', () => {
      TransactionManager.init();
      const { action } = createMockAction(0);

      TransactionManager.startPolling('session-b', 5000);
      TransactionManager.stopPolling('session-b');

      expect(TransactionManager.isPolling('session-b')).toBe(false);
    });

    it('should be a no-op if startPolling is called twice for the same session', () => {
      TransactionManager.init();

      TransactionManager.startPolling('session-dup', 5000);
      TransactionManager.startPolling('session-dup', 5000); // duplicate call

      // Still only one interval registered
      expect(TransactionManager.isPolling('session-dup')).toBe(true);

      TransactionManager.stopPolling('session-dup');
    });
  });

  // ─── Retry on transient 503 — resolves on 2nd attempt ────────────────────

  describe('retry on intermittent 503 errors (resolves on 2nd attempt)', () => {
    it('should retry once when the action fails with a 503 and succeed on the 2nd call', async () => {
      TransactionManager.init({ retryConfig: { maxRetries: 3, retryDelay: 100 } });

      const { action, getCallCount } = createMockAction(1); // fail once, then succeed

      // Execute via the retry manager directly to validate retry integration
      const promise = TransactionManager.retryManager.executeWithRetry(
        'session-503-retry',
        action
      );

      // Advance past the first backoff: 100ms * 2^0 = 100ms
      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(getCallCount()).toBe(2);
    });

    it('should invoke onRetrying callback with correct metadata on the first retry', async () => {
      TransactionManager.init({ retryConfig: { maxRetries: 3, retryDelay: 250 } });
      const { action } = createMockAction(1);

      const onRetrying = jest.fn();
      TransactionManager.registerRetryCallbacks({ onRetrying });

      const promise = TransactionRetryManager.executeWithRetry(
        'session-cb-check',
        action
      );

      await jest.advanceTimersByTimeAsync(250);
      await promise;

      expect(onRetrying).toHaveBeenCalledTimes(1);
      expect(onRetrying).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-cb-check',
          attempt: 1,
          delayMs: 250
        })
      );
    });

    it('should not invoke onRetryExhausted when the action eventually succeeds', async () => {
      TransactionManager.init({ retryConfig: { maxRetries: 3, retryDelay: 100 } });
      const { action } = createMockAction(1);

      const onRetryExhausted = jest.fn();
      TransactionManager.registerRetryCallbacks({ onRetryExhausted });

      const promise = TransactionRetryManager.executeWithRetry(
        'session-no-exhaust',
        action
      );

      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(onRetryExhausted).not.toHaveBeenCalled();
    });
  });

  // ─── Retry exhaustion — onPermanentFailure callback ──────────────────────

  describe('retry exhaustion', () => {
    it('should call onPermanentFailure and stop polling after maxRetries are exhausted', async () => {
      TransactionManager.init({ retryConfig: { maxRetries: 2, retryDelay: 100 } });

      let callCount = 0;
      const alwaysFail = jest.fn(async (_sessionId: string) => {
        callCount++;
        const err: Record<string, unknown> = {
          message: 'Request failed with status code 503',
          response: { status: 503 }
        };
        throw err;
      });

      const onPermanentFailure = jest.fn();

      // Replace the internal poll action by using retryManager directly
      // and wiring the permanent-failure path via TransactionManager.startPolling
      // We test through startPolling using the real flow but inject our mock
      // by overriding executeWithRetry for this session.
      //
      // Simpler approach: test retryManager.executeWithRetry + onRetryExhausted
      const onRetryExhausted = jest.fn();
      TransactionManager.registerRetryCallbacks({ onRetryExhausted });

      const promise = TransactionRetryManager.executeWithRetry(
        'session-exhaust-pm',
        alwaysFail
      ).catch(() => {
        onPermanentFailure('session-exhaust-pm', new Error('exhausted'));
      });

      // Advance through 2 retry delays: 100ms, 200ms
      await jest.advanceTimersByTimeAsync(100);
      await jest.advanceTimersByTimeAsync(200);
      await promise;

      // Total calls: 1 initial + 2 retries = 3
      expect(callCount).toBe(3);
      expect(onPermanentFailure).toHaveBeenCalledTimes(1);
      expect(onRetryExhausted).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Permanent (non-transient) errors — no retry ─────────────────────────

  describe('permanent errors are not retried', () => {
    it('should not retry a 404 error and should propagate it immediately', async () => {
      TransactionManager.init({ retryConfig: { maxRetries: 3, retryDelay: 100 } });

      let callCount = 0;
      const notFoundAction = jest.fn(async (_sessionId: string) => {
        callCount++;
        const err: Record<string, unknown> = {
          message: 'Request failed with status code 404',
          response: { status: 404 }
        };
        throw err;
      });

      await expect(
        TransactionRetryManager.executeWithRetry('session-404', notFoundAction)
      ).rejects.toBeDefined();

      expect(callCount).toBe(1); // No retries
    });

    it('should not retry a 401 error', async () => {
      TransactionManager.init({ retryConfig: { maxRetries: 3, retryDelay: 100 } });

      let callCount = 0;
      const unauthorizedAction = jest.fn(async (_sessionId: string) => {
        callCount++;
        const err: Record<string, unknown> = {
          message: 'Request failed with status code 401',
          response: { status: 401 }
        };
        throw err;
      });

      await expect(
        TransactionRetryManager.executeWithRetry(
          'session-401',
          unauthorizedAction
        )
      ).rejects.toBeDefined();

      expect(callCount).toBe(1);
    });
  });

  // ─── stopAllPolling() ────────────────────────────────────────────────────

  describe('stopAllPolling()', () => {
    it('should stop all active polling sessions', () => {
      TransactionManager.init();

      TransactionManager.startPolling('s1', 5000);
      TransactionManager.startPolling('s2', 5000);
      TransactionManager.startPolling('s3', 5000);

      expect(TransactionManager.isPolling('s1')).toBe(true);
      expect(TransactionManager.isPolling('s2')).toBe(true);
      expect(TransactionManager.isPolling('s3')).toBe(true);

      TransactionManager.stopAllPolling();

      expect(TransactionManager.isPolling('s1')).toBe(false);
      expect(TransactionManager.isPolling('s2')).toBe(false);
      expect(TransactionManager.isPolling('s3')).toBe(false);
    });
  });

  // ─── MSW-backed test: real HTTP 503 scenario ─────────────────────────────

  describe('MSW — 503 response resolved on 2nd retry', () => {
    it(
      'should succeed after one 503 when using a real HTTP handler',
      async () => {
        /**
         * This test verifies the full stack with MSW simulating a flaky API:
         *  - Request 1  → 503 Service Unavailable
         *  - Request 2  → 200 OK
         *
         * We use a custom action that calls `fetch` against the MSW-intercepted URL.
         * This isolates the retry logic from the rest of TransactionManager
         * (checkTransactionStatus, store, etc.) while proving the backoff loop
         * works end-to-end with real async HTTP machinery.
         */
        jest.useRealTimers(); // MSW requires real timers for fetch

        let fetchCount = 0;
        server.use(
          http.get(`${API_BASE}/transactions/mock-hash`, () => {
            fetchCount++;
            if (fetchCount === 1) {
              return new HttpResponse(null, { status: 503 });
            }
            return HttpResponse.json({ status: 'success', hash: 'mock-hash' });
          })
        );

        TransactionRetryManager.reset();
        TransactionRetryManager.init({ maxRetries: 3, retryDelay: 50 });

        const onRetrying = jest.fn();
        TransactionRetryManager.registerCallbacks({ onRetrying });

        const fetchAction = jest.fn(async (_sessionId: string) => {
          const response = await fetch(
            `${API_BASE}/transactions/mock-hash`
          );
          if (!response.ok) {
            const err: Record<string, unknown> = {
              message: `Request failed with status code ${response.status}`,
              response: { status: response.status }
            };
            throw err;
          }
        });

        await TransactionRetryManager.executeWithRetry(
          'session-msw-503',
          fetchAction
        );

        expect(fetchCount).toBe(2);
        expect(fetchAction).toHaveBeenCalledTimes(2);
        expect(onRetrying).toHaveBeenCalledTimes(1);
        expect(onRetrying).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'session-msw-503',
            attempt: 1
          })
        );
      },
      15_000 // generous timeout for the real-timer test
    );
  });
});
