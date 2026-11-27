import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { RoundsModule } from '../rounds/rounds.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { ProviderTransactionsController } from './controllers/provider-transactions.controller.js';
import { WageringTransactionsController } from './controllers/wagering-transactions.controller.js';
import { SubmitTransactionService } from './services/submit-transaction.service.js';
import { TransactionQueryService } from './services/transaction-query.service.js';

/** /wagering/transactions e /providers/.../wagering/transactions; o consumer SQS fica no worker. */
@Module({
  imports: [WalletsModule, TransactionsModule, OutboxModule, RoundsModule, InboxModule],
  controllers: [WageringTransactionsController, ProviderTransactionsController],
  providers: [SubmitTransactionService, TransactionQueryService],
  exports: [SubmitTransactionService],
})
export class WageringModule {}
