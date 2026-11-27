import { CurrencyMismatchError, InvalidMoneyError } from '../../../shared/domain/errors.js';
import { newId } from '../../../shared/domain/id.js';
import { Money } from '../../../shared/domain/money.js';
import { LedgerDirection } from '../../transactions/domain/ledger-direction.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';
import { InsufficientBalanceError } from './wallet.errors.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balanceAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate root do saldo (REQUISITOS §6.2): saldo nunca negativo, version só muda quando o saldo
 * muda, e toda mudança de saldo produz o lançamento correspondente (ESCOLHAS #12).
 */
export class Wallet {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly createdAt: Date;
  private _balanceAmount: string;
  private _version: number;
  private _updatedAt: Date;

  private constructor(state: WalletState) {
    this.id = state.id;
    this.playerId = state.playerId;
    this.currency = state.currency;
    this._balanceAmount = state.balanceAmount;
    this._version = state.version;
    this.createdAt = state.createdAt;
    this._updatedAt = state.updatedAt;
  }

  /** Nasce em version 1 com o saldo inicial; o lançamento de OPENING é gravado pelo caso de uso. */
  static open(props: { id?: string; playerId: string; initialBalance: Money; at?: Date }): Wallet {
    const at = props.at ?? new Date();

    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyError('Initial balance must not be negative', 'initialBalance.amount');
    }

    return new Wallet({
      id: props.id ?? newId(),
      playerId: props.playerId,
      currency: props.initialBalance.currency,
      balanceAmount: props.initialBalance.toJSON().amount,
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
  }

  /** Reconstrução a partir da persistência; não revalida transições. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }

  get balance(): Money {
    return Money.from({ amount: this._balanceAmount, currency: this.currency });
  }

  /** Valor do saldo como string decimal, a forma persistida em `balance_amount`. */
  get balanceAmount(): string {
    return this._balanceAmount;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** Lançamento de abertura com o saldo inicial, na version 1 (só quando o saldo inicial é positivo). */
  openingEntry(transactionId: string): WalletLedgerEntry {
    return WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money: this.balance,
      balanceBefore: Money.zero(this.currency),
      balanceAfter: this.balance,
      walletVersion: this._version,
      createdAt: this.createdAt,
    });
  }

  debit(money: Money, transactionId: string, at: Date): WalletLedgerEntry {
    this.assertSameCurrency(money);
    const before = this.balance;
    const after = before.subtract(money);

    if (after.isNegative()) {
      throw new InsufficientBalanceError(this.id);
    }

    return this.apply(LedgerDirection.Debit, money, before, after, transactionId, at);
  }

  credit(money: Money, transactionId: string, at: Date): WalletLedgerEntry {
    this.assertSameCurrency(money);
    const before = this.balance;
    return this.apply(LedgerDirection.Credit, money, before, before.add(money), transactionId, at);
  }

  private apply(
    direction: LedgerDirection,
    money: Money,
    before: Money,
    after: Money,
    transactionId: string,
    at: Date,
  ): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      walletId: this.id,
      transactionId,
      direction,
      money,
      balanceBefore: before,
      balanceAfter: after,
      walletVersion: this._version + 1,
      createdAt: at,
    });
    this._balanceAmount = after.toJSON().amount;
    this._version += 1;
    this._updatedAt = at;
    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
