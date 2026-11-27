import { Module } from '@nestjs/common';
import { WagerTransactionRepository } from './repositories/wager-transaction.repository.js';
import { TransactionsService } from './services/transactions.service.js';

/** Persistência de `WagerTransaction`, usada pelos casos de uso de wallets e wagering. */
@Module({
  providers: [WagerTransactionRepository, TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
