import { Injectable } from '@nestjs/common';
import { currentCorrelationId } from '../../../observability/correlation.js';
import { OutboxService } from '../../outbox/services/outbox.service.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.event.js';
import type { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import type { Wallet } from '../domain/wallet.js';
import { WalletNotFoundError } from '../domain/wallet.errors.js';
import { WalletLedgerRepository } from '../repositories/wallet-ledger.repository.js';
import { WalletRepository } from '../repositories/wallet.repository.js';

/**
 * O que o wagering usa da wallet, sempre dentro da transação aberta por ele: carregar, e gravar a
 * mudança de saldo junto com o lançamento e o evento (ESCOLHAS #12).
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly ledger: WalletLedgerRepository,
    private readonly outbox: OutboxService,
  ) {}

  async get(walletId: string): Promise<Wallet> {
    const wallet = await this.wallets.findById(walletId);

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return wallet;
  }

  /** Saldo com checagem de versão, lançamento e WalletBalanceChanged no mesmo commit. */
  async commit(wallet: Wallet, expectedVersion: number, entry: WalletLedgerEntry): Promise<void> {
    await this.wallets.save(wallet, expectedVersion);
    await this.ledger.add(entry);
    this.outbox.enqueue(
      WalletBalanceChanged.from(entry, {
        correlationId: currentCorrelationId() ?? entry.transactionId,
      }),
    );
  }
}
