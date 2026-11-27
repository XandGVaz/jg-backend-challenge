import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError } from '../../../shared/domain/errors.js';
import { Money } from '../../../shared/domain/money.js';
import { LedgerDirection } from '../../transactions/domain/ledger-direction.js';
import { Wallet } from './wallet.js';
import { InsufficientBalanceError } from './wallet.errors.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const open = (amount = '100.00') =>
  Wallet.open({ playerId: '00000000-0000-4000-8000-000000000001', initialBalance: brl(amount) });
const at = new Date('2026-11-27T00:00:00.000Z');

describe('Wallet', () => {
  it('opens at version 1 with the initial balance', () => {
    const wallet = open();

    expect(wallet.version).toBe(1);
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  it('refuses a negative initial balance', () => {
    expect(() => open('-1.00')).toThrow(InvalidMoneyError);
  });

  it('debits, increments the version and returns the ledger entry of that version', () => {
    const wallet = open();
    const entry = wallet.debit(brl('80.00'), 'tx-1', at);

    expect(wallet.balance.toJSON().amount).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.walletVersion).toBe(2);
    expect(entry.balanceBefore.toJSON().amount).toBe('100.00');
    expect(entry.balanceAfter.toJSON().amount).toBe('20.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('never goes negative and changes nothing when the balance is insufficient', () => {
    const wallet = open();

    expect(() => wallet.debit(brl('100.01'), 'tx-1', at)).toThrow(InsufficientBalanceError);
    expect(wallet.balance.toJSON().amount).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('allows a debit that leaves exactly zero', () => {
    const wallet = open();
    wallet.debit(brl('100.00'), 'tx-1', at);

    expect(wallet.balance.isZero()).toBe(true);
  });

  it('credits and increments the version', () => {
    const wallet = open('0.00');
    const entry = wallet.credit(brl('25.50'), 'tx-1', at);

    expect(wallet.balance.toJSON().amount).toBe('25.50');
    expect(entry.walletVersion).toBe(2);
  });

  it('rejects an operation in another currency', () => {
    const wallet = open();

    expect(() =>
      wallet.credit(Money.from({ amount: '1.00', currency: 'USD' }), 'tx-1', at),
    ).toThrow(CurrencyMismatchError);
  });

  it('builds the opening entry at version 1 from zero to the initial balance', () => {
    const wallet = open('50.00');
    const entry = wallet.openingEntry('opening-tx');

    expect(entry.walletVersion).toBe(1);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.isZero()).toBe(true);
    expect(entry.balanceAfter.toJSON().amount).toBe('50.00');
  });
});
