import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsController } from './controllers/wallets.controller.js';
import { WalletLedgerRepository } from './repositories/wallet-ledger.repository.js';
import { WalletRepository } from './repositories/wallet.repository.js';
import { OpenWalletService } from './services/open-wallet.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';
import { WalletQueryService } from './services/wallet-query.service.js';
import { WalletsService } from './services/wallets.service.js';

/** Wallets, ledger e reconciliação: /wallets, /wallets/:walletId/ledger e /wallets/:walletId/reconciliation. */
@Module({
  imports: [TransactionsModule, OutboxModule],
  controllers: [WalletsController],
  providers: [
    WalletRepository,
    WalletLedgerRepository,
    WalletsService,
    OpenWalletService,
    WalletQueryService,
    ReconciliationService,
  ],
  exports: [WalletsService],
})
export class WalletsModule {}
