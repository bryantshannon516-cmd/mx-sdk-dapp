import { computeBackoffDelay } from '../helpers/computeBackoffDelay';

describe('computeBackoffDelay', () => {
  it('should return baseDelayMs unchanged for the first retry attempt (attemptIndex=0)', () => {
    expect(computeBackoffDelay(1000, 0)).toBe(1000);
  });

  it('should double the delay for the second retry attempt (attemptIndex=1)', () => {
    expect(computeBackoffDelay(1000, 1)).toBe(2000);
  });

  it('should quadruple the delay for the third retry attempt (attemptIndex=2)', () => {
    expect(computeBackoffDelay(1000, 2)).toBe(4000);
  });

  it('should correctly scale with a custom baseDelayMs', () => {
    expect(computeBackoffDelay(500, 0)).toBe(500);
    expect(computeBackoffDelay(500, 1)).toBe(1000);
    expect(computeBackoffDelay(500, 2)).toBe(2000);
    expect(computeBackoffDelay(500, 3)).toBe(4000);
  });

  it('should follow the formula baseDelayMs * 2^attemptIndex', () => {
    const base = 250;
    for (let i = 0; i <= 5; i++) {
      expect(computeBackoffDelay(base, i)).toBe(base * Math.pow(2, i));
    }
  });
});
