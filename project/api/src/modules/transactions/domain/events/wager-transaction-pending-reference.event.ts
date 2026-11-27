import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../../../shared/domain/integration-event.js';
import { InvalidTransactionStateError } from '../wager-transaction.errors.js';
import type { WagerTransaction } from '../wager-transaction.js';
import { WagerTransactionStatus } from '../wager-transaction-status.js';
import {
  assertStatus,
  eventBase,
  type EventContext,
  type WagerTransactionEventBase,
} from './wager-transaction-event-data.js';

export interface WagerTransactionPendingReferenceData extends WagerTransactionEventBase {
  referenceExternalTransactionId: string;
  attempts: number;
  nextAttemptAt: string;
}

type PendingReferenceData = WagerTransactionPendingReferenceData;

/** Referência ausente: a transação aguarda o reprocessamento (REQUISITOS §7.1 e §11). */
export class WagerTransactionPendingReference extends IntegrationEvent<PendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<PendingReferenceData>) {
    super(props);
  }

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    assertStatus(transaction, WagerTransactionStatus.PendingReference, 'PendingReference');
    const reference = transaction.referenceExternalTransactionId;
    const nextAttemptAt = transaction.nextReferenceAttemptAt;

    if (reference === undefined || nextAttemptAt === undefined) {
      throw new InvalidTransactionStateError(transaction.id, transaction.status, 'emit pending');
    }

    return new WagerTransactionPendingReference({
      ...ctx,
      aggregateId: transaction.id,
      data: {
        ...eventBase(transaction),
        referenceExternalTransactionId: reference,
        attempts: transaction.referenceAttempts,
        nextAttemptAt: nextAttemptAt.toISOString(),
      },
    });
  }
}
