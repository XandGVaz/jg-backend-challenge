import { describe, expect, it } from 'bun:test';
import { retryDelaySeconds } from './retry-backoff.js';

describe('retryDelaySeconds', () => {
  it('doubles the ceiling on each attempt', () => {
    const max = (attempt: number): number => retryDelaySeconds(attempt, () => 1);

    expect([1, 2, 3, 4, 5].map(max)).toEqual([2, 4, 8, 16, 32]);
  });

  it('never goes below half of the ceiling', () => {
    expect(retryDelaySeconds(4, () => 0)).toBe(8);
  });

  it('caps at 300 seconds', () => {
    expect(retryDelaySeconds(30, () => 1)).toBe(300);
  });

  it('treats attempt 0 as the first attempt', () => {
    expect(retryDelaySeconds(0, () => 1)).toBe(2);
  });

  it('honours a custom base and cap', () => {
    const max = (attempt: number): number =>
      retryDelaySeconds(attempt, () => 1, { baseSeconds: 5, maxSeconds: 60 });

    expect([1, 2, 3, 5].map(max)).toEqual([5, 10, 20, 60]);
  });

  it('falls back to the shared defaults when an option is omitted', () => {
    expect(retryDelaySeconds(3, () => 1, { baseSeconds: 10 })).toBe(40);
    expect(retryDelaySeconds(3, () => 1, { maxSeconds: 500 })).toBe(8);
  });
});
