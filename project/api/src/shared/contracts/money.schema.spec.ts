import { describe, expect, it } from 'bun:test';
import { CurrencySchema, MoneySchema, SignedMoneySchema } from './money.schema.js';

describe('money schemas', () => {
  it('accepts non-negative decimal strings with exactly two places', () => {
    expect(MoneySchema.parse({ amount: '0.00', currency: 'BRL' })).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });
    expect(MoneySchema.safeParse({ amount: '25.99', currency: 'USD' }).success).toBe(true);
  });

  it('accepts signed amounts only in SignedMoneySchema', () => {
    expect(SignedMoneySchema.parse({ amount: '-5.00', currency: 'BRL' }).amount).toBe('-5.00');
    expect(SignedMoneySchema.safeParse({ amount: '5.00', currency: 'BRL' }).success).toBe(true);
    expect(MoneySchema.safeParse({ amount: '-5.00', currency: 'BRL' }).success).toBe(false);
  });

  it.each([
    25,
    '25',
    '25.0',
    '25.000',
    '2.5e1',
    '+25.00',
    ' 25.00',
    '025.00',
    '',
    'NaN',
    'Infinity',
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid input amount %s', (amount) => {
    expect(MoneySchema.safeParse({ amount, currency: 'BRL' }).success).toBe(false);
  });

  it('rejects malformed currencies and unknown properties', () => {
    for (const currency of ['brl', 'BR', 'BRLR', 'BR1', '']) {
      expect(CurrencySchema.safeParse(currency).success).toBe(false);
    }

    expect(MoneySchema.safeParse({ amount: '1.00', currency: 'BRL', extra: true }).success).toBe(
      false,
    );
  });
});
