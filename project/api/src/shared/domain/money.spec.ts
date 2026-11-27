import { describe, expect, it } from 'bun:test';
import { ErrorKind } from '../errors/app-error.js';
import { CurrencyMismatchError, InvalidMoneyError } from './errors.js';
import { Money } from './money.js';

function money(amount: string, currency = 'BRL'): Money {
  return Money.from({ amount, currency });
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }

  throw new Error('Expected operation to throw');
}

describe('Money', () => {
  it('creates positive and signed values with fixed scale', () => {
    expect(money('25.00').toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(money('-5.40').toJSON()).toEqual({ amount: '-5.40', currency: 'BRL' });
    expect(money('25.00').toString()).toBe('25.00 BRL');
  });

  it('creates zero and identifies its sign', () => {
    const zero = Money.zero('BRL');

    expect(zero.toJSON()).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
    expect(money('0.01').isPositive()).toBe(true);
    expect(money('-0.01').isNegative()).toBe(true);
  });

  it('adds without binary floating-point rounding', () => {
    const left = money('0.10');
    const right = money('0.20');
    const result = left.add(right);

    expect(result.toJSON().amount).toBe('0.30');
    expect(result).not.toBe(left);
    expect(left.toJSON().amount).toBe('0.10');
    expect(right.toJSON().amount).toBe('0.20');
  });

  it('subtracts exactly and preserves scale for negative results', () => {
    expect(money('1.00').subtract(money('0.01')).toJSON().amount).toBe('0.99');
    expect(money('0.01').subtract(money('0.02')).toJSON().amount).toBe('-0.01');
  });

  it('keeps arithmetic exact at the persistence precision limit', () => {
    const result = money('999999999999999999.99').add(money('0.01'));

    expect(result.toJSON().amount).toBe('1000000000000000000.00');
  });

  it('does not round arithmetic beyond the persistence precision', () => {
    expect(money('12345678901234567890.00').add(money('0.01')).toJSON().amount).toBe(
      '12345678901234567890.01',
    );
    expect(money('12345678901234567890.00').subtract(money('0.01')).toJSON().amount).toBe(
      '12345678901234567889.99',
    );
  });

  it('negates into a new immutable value', () => {
    const original = money('10.00');
    const negative = original.negate();

    expect(negative.toJSON().amount).toBe('-10.00');
    expect(negative.negate().toJSON().amount).toBe('10.00');
    expect(original.toJSON().amount).toBe('10.00');
  });

  it('compares values and checks equality', () => {
    expect(money('1.00').isLessThan(money('1.01'))).toBe(true);
    expect(money('1.01').isLessThan(money('1.00'))).toBe(false);
    expect(money('1.00').equals(money('1.00'))).toBe(true);
    expect(money('1.00').equals(money('2.00'))).toBe(false);
  });

  it.each([
    'NaN',
    'Infinity',
    '-Infinity',
    '1e2',
    '2.5e1',
    '',
    '25',
    '25.0',
    '25.000',
    '+25.00',
    ' 25.00',
    '025.00',
    '.00',
    '--1.00',
    25,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
  ])('rejects invalid amount %s', (amount) => {
    const error = captureError(() => money(amount as string));

    expect(error).toBeInstanceOf(InvalidMoneyError);
    expect((error as InvalidMoneyError).kind).toBe(ErrorKind.Validation);
    expect((error as InvalidMoneyError).code).toBe('INVALID_MONEY');
  });

  it.each(['', 'brl', 'BR', 'BRLR', 'B R', 'BR1', null, undefined])(
    'rejects invalid currency %s',
    (currency) => {
      expect(() => Money.from({ amount: '1.00', currency: currency as string })).toThrow(
        InvalidMoneyError,
      );
    },
  );

  it('rejects every operation between different currencies', () => {
    const brl = money('1.00');
    const usd = money('1.00', 'USD');
    const operations = [
      () => brl.add(usd),
      () => brl.subtract(usd),
      () => brl.isLessThan(usd),
      () => brl.equals(usd),
    ];

    for (const operation of operations) {
      const error = captureError(operation);

      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect((error as CurrencyMismatchError).kind).toBe(ErrorKind.BusinessRule);
      expect((error as CurrencyMismatchError).code).toBe('CURRENCY_MISMATCH');
    }
  });
});
