import { describe, expect, it, mock } from 'bun:test';
import { Money } from '../../../shared/domain/money.js';
import { Wallet } from '../domain/wallet.js';
import type { WalletLedgerRepository } from '../repositories/wallet-ledger.repository.js';
import { ReconciliationService } from './reconciliation.service.js';
import type { WalletsService } from './wallets.service.js';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const at = new Date();

function setup(storedOverride?: string) {
  const wallet = Wallet.open({
    playerId: '00000000-0000-4000-8000-000000000001',
    initialBalance: brl('100.00'),
  });
  const opening = wallet.openingEntry('opening');
  const bet = wallet.debit(brl('80.00'), 'bet', at);
  const view = storedOverride
    ? Wallet.rehydrate({
        id: wallet.id,
        playerId: wallet.playerId,
        currency: 'BRL',
        balanceAmount: storedOverride,
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      })
    : wallet;
  const wallets = { get: mock(async () => view) } as unknown as WalletsService;
  const ledger = { all: mock(async () => [opening, bet]) } as unknown as WalletLedgerRepository;
  return new ReconciliationService(wallets, ledger);
}

describe('ReconciliationService', () => {
  it('reports a consistent wallet when the ledger rebuilds the stored balance', async () => {
    const report = await setup().reconcile('wallet');

    expect(report.consistent).toBe(true);
    expect(report.storedBalance.amount).toBe('20.00');
    expect(report.calculatedBalance.amount).toBe('20.00');
    expect(report.difference.amount).toBe('0.00');
    expect(report.checkedEntries).toBe(2);
  });

  it('reports the signed difference when they diverge', async () => {
    const report = await setup('15.00').reconcile('wallet');

    expect(report.consistent).toBe(false);
    expect(report.difference.amount).toBe('-5.00');
  });
});
