import { Decimal } from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './errors.js';

const AMOUNT_PATTERN = /^-?(0|[1-9]\d*)\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
// O construtor local evita o arredondamento da precisão global padrão nas operações.
const ExactDecimal = Decimal.clone({ precision: 1_000_000_000 });

export interface MoneyProps {
  amount: string;
  currency: string;
}

/** Valor monetário exato e imutável, sempre serializado com duas casas decimais. */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (typeof props.amount !== 'string') {
      throw new InvalidMoneyError('Money amount must be a decimal string', 'money.amount');
    }

    if (!AMOUNT_PATTERN.test(props.amount)) {
      throw new InvalidMoneyError(
        'Money amount must have exactly 2 decimal places',
        'money.amount',
      );
    }

    if (typeof props.currency !== 'string') {
      throw new InvalidMoneyError('Money currency must be a string', 'money.currency');
    }

    if (!CURRENCY_PATTERN.test(props.currency)) {
      throw new InvalidMoneyError(
        'Money currency must contain exactly 3 uppercase letters',
        'money.currency',
      );
    }

    return new Money(new ExactDecimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
