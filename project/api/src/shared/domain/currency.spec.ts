import { describe, expect, it } from 'bun:test';
import { ACCEPTED_CURRENCIES, isAcceptedCurrency } from './currency.js';

describe('accepted currencies', () => {
  it('accepts only BRL in the configured list', () => {
    expect(ACCEPTED_CURRENCIES).toEqual(['BRL']);
    expect(isAcceptedCurrency('BRL')).toBe(true);
    expect(isAcceptedCurrency('USD')).toBe(false);
    expect(isAcceptedCurrency('brl')).toBe(false);
    expect(isAcceptedCurrency('')).toBe(false);
  });
});
