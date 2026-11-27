import type { Money } from '../../shared/domain/money.js';
import type { WagerTransaction } from '../transactions/domain/wager-transaction.js';
import type { SubmitTransactionResponse, TransactionView } from './wagering.schema.js';

export function toSubmitResponse(
  transaction: WagerTransaction,
  balance: Money,
  idempotentReplay: boolean,
): SubmitTransactionResponse {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: balance.toJSON(),
    idempotentReplay,
  };
}

export function toTransactionView(transaction: WagerTransaction): TransactionView {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    idempotencyKey: transaction.idempotencyKey,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    status: transaction.status,
    ...(transaction.referenceExternalTransactionId !== undefined && {
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    }),
    ...(transaction.referenceTransactionId !== undefined && {
      referenceTransactionId: transaction.referenceTransactionId,
    }),
    ...(transaction.failureCode !== undefined && { failureCode: transaction.failureCode }),
    createdAt: transaction.createdAt.toISOString(),
    ...(transaction.processedAt !== undefined && {
      processedAt: transaction.processedAt.toISOString(),
    }),
  };
}
