import { newId } from '../../../shared/domain/id.js';
import { Money } from '../../../shared/domain/money.js';
import { LedgerDirection } from '../../transactions/domain/ledger-direction.js';
import { UnbalancedLedgerEntryError } from './wallet.errors.js';

export interface CreateLedgerEntryProps {
  id?: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  walletVersion: number;
  createdAt: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balanceBeforeAmount: string;
  balanceAfterAmount: string;
  walletVersion: number;
  createdAt: Date;
}

/** Lançamento imutável do ledger (REQUISITOS §6.4): sem campos mutáveis nem transições. */
export class WalletLedgerEntry {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  /** Versão da wallet depois deste lançamento (V2, ESCOLHAS #12). */
  readonly walletVersion: number;
  readonly createdAt: Date;
  private readonly amount: string;
  private readonly currency: string;
  private readonly balanceBeforeAmount: string;
  private readonly balanceAfterAmount: string;

  private constructor(state: LedgerEntryState) {
    this.id = state.id;
    this.walletId = state.walletId;
    this.transactionId = state.transactionId;
    this.direction = state.direction;
    this.amount = state.amount;
    this.currency = state.currency;
    this.balanceBeforeAmount = state.balanceBeforeAmount;
    this.balanceAfterAmount = state.balanceAfterAmount;
    this.walletVersion = state.walletVersion;
    this.createdAt = state.createdAt;
  }

  /** Valida a aritmética do lançamento antes de existir: balanceBefore ± money = balanceAfter. */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry({
      id: props.id ?? newId(),
      walletId: props.walletId,
      transactionId: props.transactionId,
      direction: props.direction,
      amount: props.money.toJSON().amount,
      currency: props.money.currency,
      balanceBeforeAmount: props.balanceBefore.toJSON().amount,
      balanceAfterAmount: props.balanceAfter.toJSON().amount,
      walletVersion: props.walletVersion,
      createdAt: props.createdAt,
    });

    if (!props.money.isPositive()) {
      throw new UnbalancedLedgerEntryError(entry.id, 'amount must be positive');
    }

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError(
        entry.id,
        'balanceBefore ± money must equal balanceAfter',
      );
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(state);
  }

  get money(): Money {
    return Money.from({ amount: this.amount, currency: this.currency });
  }

  get balanceBefore(): Money {
    return Money.from({ amount: this.balanceBeforeAmount, currency: this.currency });
  }

  get balanceAfter(): Money {
    return Money.from({ amount: this.balanceAfterAmount, currency: this.currency });
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);
    return expected.equals(this.balanceAfter);
  }

  /** Efeito assinado no saldo: positivo para crédito, negativo para débito (reconciliação). */
  signedMoney(): Money {
    return this.direction === LedgerDirection.Credit ? this.money : this.money.negate();
  }
}
