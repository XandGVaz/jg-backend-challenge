import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module.js';

/** Transações de aposta: /wagering/transactions, consulta por provider, consumer SQS e outbox. */
@Module({
  imports: [WalletsModule],
  controllers: [],
  providers: [],
})
export class WageringModule {}
