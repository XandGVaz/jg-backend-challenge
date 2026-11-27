import type { MoneyProps } from '../../../../shared/domain/money.js';
import { InvalidTransactionStateError } from '../wager-transaction.errors.js';
import type { WagerTransaction } from '../wager-transaction.js';
import type { WagerTransactionKind } from '../wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../wager-transaction-status.js';

/** Contexto de rastreio do caso de uso que emite o evento (api.md §13.1). */
export interface EventContext {
  correlationId: string;
  causationId?: string;
  occurredAt?: Date;
  eventId?: string;
}

/** Campos comuns aos eventos de transação (api.md §13.2). */
export interface WagerTransactionEventBase extends Record<string, unknown> {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export function eventBase(transaction: WagerTransaction): WagerTransactionEventBase {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    // Campo opcional ausente é omitido, nunca null (api.md §8.3).
    ...(transaction.referenceExternalTransactionId === undefined
      ? {}
      : { referenceExternalTransactionId: transaction.referenceExternalTransactionId }),
  };
}

export function assertStatus(
  transaction: WagerTransaction,
  expected: WagerTransactionStatus,
  eventType: string,
): void {
  if (transaction.status !== expected) {
    throw new InvalidTransactionStateError(transaction.id, transaction.status, eventType);
  }
}
