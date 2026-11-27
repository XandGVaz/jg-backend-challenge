import { Injectable } from '@nestjs/common';
import { TransactionsService } from '../../transactions/services/transactions.service.js';
import { toTransactionView } from '../wagering.mapper.js';
import type { TransactionView } from '../wagering.schema.js';

/** GET por id interno e por (providerId, externalTransactionId) (api.md §9.3). */
@Injectable()
export class TransactionQueryService {
  constructor(private readonly transactions: TransactionsService) {}

  async getById(transactionId: string): Promise<TransactionView> {
    return toTransactionView(await this.transactions.getById(transactionId));
  }

  async getByExternal(providerId: string, externalTransactionId: string): Promise<TransactionView> {
    return toTransactionView(
      await this.transactions.getByExternalId(providerId, externalTransactionId),
    );
  }
}
