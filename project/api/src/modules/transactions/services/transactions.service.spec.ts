import { describe, expect, it, mock } from 'bun:test';
import { Money } from '../../../shared/domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import {
  InvalidTransactionReferenceError,
  TransactionNotFoundError,
} from '../domain/wager-transaction.errors.js';
import { WagerTransactionKind } from '../domain/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../domain/wager-transaction-status.js';
import type { WagerTransactionRepository } from '../repositories/wager-transaction.repository.js';
import { TransactionsService } from './transactions.service.js';

const CREATED_AT = new Date('2026-11-26T15:00:00.000Z');
const WALLET_ID = '0192f2a0-0000-7000-8000-000000000001';
const PLAYER_ID = '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f';

function props(kind: WagerTransactionKind, referenceExternalTransactionId?: string) {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'tx-2',
    idempotencyKey: 'provider-a:tx-2',
    payloadHash: `v1:${'a'.repeat(64)}`,
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    referenceExternalTransactionId,
    createdAt: CREATED_AT,
  };
}

function serviceWith(repository: Partial<Record<keyof WagerTransactionRepository, unknown>>) {
  return new TransactionsService(repository as unknown as WagerTransactionRepository);
}

describe('TransactionsService', () => {
  it('registers a new transaction in PENDING and inserts it', async () => {
    const insert = mock(async () => undefined);

    const transaction = await serviceWith({ insert }).register(props(WagerTransactionKind.Bet));

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(insert).toHaveBeenCalledWith(transaction);
  });

  it('does not insert when the domain refuses the reference rules', async () => {
    const insert = mock(async () => undefined);
    const service = serviceWith({ insert });

    expect(
      await service.register(props(WagerTransactionKind.Refund)).catch((error: unknown) => error),
    ).toBeInstanceOf(InvalidTransactionReferenceError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('records the OPENING already PROCESSED with the initial balance observed', async () => {
    const insert = mock(async () => undefined);
    const money = Money.from({ amount: '100.00', currency: 'BRL' });

    const opening = await serviceWith({ insert }).recordOpening({
      walletId: WALLET_ID,
      playerId: PLAYER_ID,
      money,
      createdAt: CREATED_AT,
    });

    expect(opening.kind).toBe(WagerTransactionKind.Opening);
    expect(opening.status).toBe(WagerTransactionStatus.Processed);
    expect(opening.processedAt).toBe(CREATED_AT);
    expect(opening.resultBalance?.toJSON()).toEqual(money.toJSON());
    expect(insert).toHaveBeenCalledWith(opening);
  });

  it('raises TRANSACTION_NOT_FOUND on the get variants', async () => {
    const findById = mock(async () => undefined);
    const findByExternalId = mock(async () => undefined);
    const service = serviceWith({ findById, findByExternalId });

    expect(await service.getById('missing').catch((error: unknown) => error)).toBeInstanceOf(
      TransactionNotFoundError,
    );
    expect(
      await service.getByExternalId('provider-a', 'missing').catch((error: unknown) => error),
    ).toBeInstanceOf(TransactionNotFoundError);
  });

  it('resolves the reference by provider and external id with a row lock', async () => {
    const bet = WagerTransaction.create({ ...props(WagerTransactionKind.Bet), id: undefined });
    const findByExternalId = mock(async () => bet);
    const refund = WagerTransaction.create(props(WagerTransactionKind.Refund, 'tx-1'));

    const found = await serviceWith({ findByExternalId }).findReferenceForUpdate(refund);

    expect(found).toBe(bet);
    expect(findByExternalId).toHaveBeenCalledWith('provider-a', 'tx-1', { forUpdate: true });
  });

  it('skips the lookup when there is no reference', async () => {
    const findByExternalId = mock(async () => undefined);
    const service = serviceWith({ findByExternalId });

    const found = await service.findReferenceForUpdate(
      WagerTransaction.create(props(WagerTransactionKind.Bet)),
    );

    expect(found).toBeUndefined();
    expect(findByExternalId).not.toHaveBeenCalled();
  });

  it('checks cancellation and expedites waiters by the provider identity of the transaction', async () => {
    const existsRejectedRefundFor = mock(async () => false);
    const expediteReferenceAttempts = mock(async () => 1);
    const service = serviceWith({ existsRejectedRefundFor, expediteReferenceAttempts });
    const bet = WagerTransaction.create(props(WagerTransactionKind.Bet));
    const at = new Date('2026-11-26T15:00:05.000Z');

    expect(await service.isCancelledBet(bet)).toBe(false);
    expect(await service.expediteWaitingFor(bet, at)).toBe(1);
    expect(existsRejectedRefundFor).toHaveBeenCalledWith('provider-a', 'tx-2');
    expect(expediteReferenceAttempts).toHaveBeenCalledWith('provider-a', 'tx-2', at);
  });
});
