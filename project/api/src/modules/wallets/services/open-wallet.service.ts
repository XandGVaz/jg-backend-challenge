import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { trace } from '@opentelemetry/api';
import { loadEnv } from '../../../config/env.js';
import { runTransaction } from '../../../database/run-transaction.js';
import { currentCorrelationId } from '../../../observability/correlation.js';
import { isAcceptedCurrency } from '../../../shared/domain/currency.js';
import { Money } from '../../../shared/domain/money.js';
import { RequestValidationError } from '../../../shared/errors/request-validation.error.js';
import { OutboxService } from '../../outbox/services/outbox.service.js';
import { TransactionsService } from '../../transactions/services/transactions.service.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.event.js';
import { Wallet } from '../domain/wallet.js';
import { WalletLedgerRepository } from '../repositories/wallet-ledger.repository.js';
import { WalletRepository } from '../repositories/wallet.repository.js';
import { toWalletView } from '../wallets.mapper.js';
import type { CreateWalletRequest, WalletView } from '../wallets.schema.js';

const tracer = trace.getTracer('wagering-api.wallets');

/** POST /wallets: wallet, transação OPENING e, com saldo inicial, lançamento e evento (ESCOLHAS #21). */
@Injectable()
export class OpenWalletService {
  private readonly logger = new Logger(OpenWalletService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly em: EntityManager,
    private readonly wallets: WalletRepository,
    private readonly ledger: WalletLedgerRepository,
    private readonly transactions: TransactionsService,
    private readonly outbox: OutboxService,
  ) {}

  open(input: CreateWalletRequest): Promise<WalletView> {
    if (!isAcceptedCurrency(input.initialBalance.currency)) {
      this.logger.warn({
        message: 'Currency not accepted',
        currency: input.initialBalance.currency,
      });
      throw RequestValidationError.fromIssues([
        { path: ['initialBalance', 'currency'], message: 'Currency not accepted' },
      ]);
    }

    const options = {
      useCase: 'open_wallet',
      maxAttempts: this.env.OPTIMISTIC_LOCK_MAX_ATTEMPTS,
    } as const;

    return tracer.startActiveSpan('wallet.open', async (span) => {
      try {
        const view = await runTransaction(this.em, options, () => this.openInTransaction(input));
        span.setAttribute('wagering.wallet_id', view.id);
        return view;
      } finally {
        span.end();
      }
    });
  }

  private async openInTransaction(input: CreateWalletRequest): Promise<WalletView> {
    const at = new Date();
    const initialBalance = Money.from(input.initialBalance);
    const wallet = Wallet.open({ playerId: input.playerId, initialBalance, at });
    await this.wallets.add(wallet);

    const opening = await this.transactions.recordOpening({
      walletId: wallet.id,
      playerId: wallet.playerId,
      money: initialBalance,
      createdAt: at,
    });

    // Saldo zero: a OPENING fica registrada, mas o ledger exige amount > 0 e o saldo não muda.
    if (initialBalance.isPositive()) {
      const entry = wallet.openingEntry(opening.id);
      await this.ledger.add(entry);
      this.outbox.enqueue(
        WalletBalanceChanged.from(entry, { correlationId: currentCorrelationId() ?? opening.id }),
      );
    }

    this.logger.log({ message: 'Wallet opened', walletId: wallet.id, transactionId: opening.id });
    return toWalletView(wallet);
  }
}
