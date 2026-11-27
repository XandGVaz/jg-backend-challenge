import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../../../shared/domain/integration-event.js';
import type { FailureCode } from '../../../../shared/domain/failure-code.js';
import { InvalidTransactionStateError } from '../wager-transaction.errors.js';
import type { WagerTransaction } from '../wager-transaction.js';
import { WagerTransactionStatus } from '../wager-transaction-status.js';
import {
  assertStatus,
  eventBase,
  type EventContext,
  type WagerTransactionEventBase,
} from './wager-transaction-event-data.js';

export interface WagerTransactionRejectedData extends WagerTransactionEventBase {
  failureCode: FailureCode;
  rejectedAt: string;
}

/** Transação REJECTED por regra de negócio (REQUISITOS §11). */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }

  /** `rejectedAt` é o instante do evento: a rejeição e o evento saem da mesma transação SQL. */
  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    assertStatus(transaction, WagerTransactionStatus.Rejected, 'WagerTransactionRejected');
    const failureCode = transaction.failureCode;

    if (failureCode === undefined) {
      throw new InvalidTransactionStateError(transaction.id, transaction.status, 'emit rejection');
    }

    const occurredAt = ctx.occurredAt ?? new Date();

    return new WagerTransactionRejected({
      ...ctx,
      occurredAt,
      aggregateId: transaction.id,
      data: {
        ...eventBase(transaction),
        failureCode,
        rejectedAt: occurredAt.toISOString(),
      },
    });
  }
}
