import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../../../shared/domain/integration-event.js';
import type { Money, MoneyProps } from '../../../../shared/domain/money.js';
import type { WagerTransaction } from '../wager-transaction.js';
import { WagerTransactionStatus } from '../wager-transaction-status.js';
import {
  assertStatus,
  eventBase,
  type EventContext,
  type WagerTransactionEventBase,
} from './wager-transaction-event-data.js';

export interface WagerTransactionProcessedData extends WagerTransactionEventBase {
  referenceTransactionId?: string;
  /** Em LOSS, igual ao saldo do momento. */
  balanceAfter: MoneyProps;
  processedAt: string;
}

/** Qualquer transação aplicada, inclusive LOSS (REQUISITOS §11). */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }

  static from(
    transaction: WagerTransaction,
    balanceAfter: Money,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    assertStatus(transaction, WagerTransactionStatus.Processed, 'WagerTransactionProcessed');
    const processedAt = transaction.processedAt ?? transaction.updatedAt;

    return new WagerTransactionProcessed({
      ...ctx,
      aggregateId: transaction.id,
      data: {
        ...eventBase(transaction),
        ...(transaction.referenceTransactionId === undefined
          ? {}
          : { referenceTransactionId: transaction.referenceTransactionId }),
        balanceAfter: balanceAfter.toJSON(),
        processedAt: processedAt.toISOString(),
      },
    });
  }
}
