import { describe, expect, it, mock } from 'bun:test';
import { LockMode, type EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../../shared/domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { DuplicateTransactionError } from '../domain/wager-transaction.errors.js';
import { WagerTransactionKind } from '../domain/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../domain/wager-transaction-status.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';

function bet(): WagerTransaction {
  return WagerTransaction.create({
    providerId: 'provider-a',
    externalTransactionId: 'tx-1',
    idempotencyKey: 'provider-a:tx-1',
    payloadHash: `v1:${'a'.repeat(64)}`,
    walletId: '0192f2a0-0000-7000-8000-000000000001',
    playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    createdAt: new Date('2026-11-26T15:00:00.000Z'),
  });
}

function repositoryWith(em: Record<string, unknown>): WagerTransactionRepository {
  return new WagerTransactionRepository({
    merge: mock(() => undefined),
    ...em,
  } as unknown as EntityManager);
}

describe('WagerTransactionRepository', () => {
  it('inserts immediately without flushing', async () => {
    const insert = mock(async () => 'id');
    const flush = mock(async () => undefined);
    const transaction = bet();

    await repositoryWith({ insert, flush }).insert(transaction);

    expect(insert).toHaveBeenCalledWith(transaction);
    expect(flush).not.toHaveBeenCalled();
  });

  it('translates the idempotency unique violation on insert', async () => {
    const violation = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'uq_wager_transactions_idempotency',
    });
    const insert = mock(async () => {
      throw violation;
    });

    const promise = repositoryWith({ insert }).insert(bet());

    expect(await promise.catch((error: unknown) => error)).toBeInstanceOf(
      DuplicateTransactionError,
    );
  });

  it('rethrows unrelated insert errors as they are', async () => {
    const failure = new Error('connection reset');
    const insert = mock(async () => {
      throw failure;
    });

    const promise = repositoryWith({ insert }).insert(bet());

    expect(await promise.catch((error: unknown) => error)).toBe(failure);
  });

  it('finds by id, idempotency key and external id, mapping null to undefined', async () => {
    const findOne = mock(async () => null);
    const repository = repositoryWith({ findOne });

    expect(await repository.findById('id-1')).toBeUndefined();
    expect(await repository.findByIdempotencyKey('provider-a:tx-1')).toBeUndefined();
    expect(await repository.findByExternalId('provider-a', 'tx-1')).toBeUndefined();
    expect(findOne).toHaveBeenNthCalledWith(1, WagerTransaction, { id: 'id-1' }, {});
    expect(findOne).toHaveBeenNthCalledWith(2, WagerTransaction, {
      idempotencyKey: 'provider-a:tx-1',
    });
    expect(findOne).toHaveBeenNthCalledWith(
      3,
      WagerTransaction,
      { providerId: 'provider-a', externalTransactionId: 'tx-1' },
      {},
    );
  });

  it('locks the row with FOR UPDATE when asked', async () => {
    const found = bet();
    const findOne = mock(async () => found);

    const result = await repositoryWith({ findOne }).findByExternalId('provider-a', 'tx-1', {
      forUpdate: true,
    });

    expect(result).toBe(found);
    expect(findOne).toHaveBeenCalledWith(
      WagerTransaction,
      { providerId: 'provider-a', externalTransactionId: 'tx-1' },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  });

  it('claims due PENDING_REFERENCE rows with SKIP LOCKED, oldest first', async () => {
    const find = mock(async () => []);
    const now = new Date('2026-11-26T15:05:00.000Z');

    await repositoryWith({ find }).claimDuePendingReferences(now, 25);

    expect(find).toHaveBeenCalledWith(
      WagerTransaction,
      {
        _status: WagerTransactionStatus.PendingReference,
        _nextReferenceAttemptAt: { $lte: now },
      },
      {
        orderBy: { _nextReferenceAttemptAt: 'asc', id: 'asc' },
        limit: 25,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
  });

  it('lists processed reversals of a reference', async () => {
    const find = mock(async () => []);

    await repositoryWith({ find }).findProcessedReversals('ref-1');

    expect(find).toHaveBeenCalledWith(WagerTransaction, {
      _referenceTransactionId: 'ref-1',
      kind: { $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback] },
      _status: WagerTransactionStatus.Processed,
    });
  });

  it('detects a rejected REFUND that cited the BET', async () => {
    const count = mock(async () => 1);

    const exists = await repositoryWith({ count }).existsRejectedRefundFor('provider-a', 'tx-1');

    expect(exists).toBe(true);
    expect(count).toHaveBeenCalledWith(WagerTransaction, {
      providerId: 'provider-a',
      referenceExternalTransactionId: 'tx-1',
      kind: WagerTransactionKind.Refund,
      _status: WagerTransactionStatus.Rejected,
    });
  });

  it('expedites waiting PENDING_REFERENCE rows with a single UPDATE', async () => {
    const at = new Date('2026-11-26T15:00:03.000Z');
    const execute = mock(async () => ({ affectedRows: 2 }));
    const where = mock(() => ({ execute }));
    const update = mock(() => ({ where }));
    const createQueryBuilder = mock(() => ({ update }));

    const affected = await repositoryWith({ createQueryBuilder }).expediteReferenceAttempts(
      'provider-a',
      'tx-1',
      at,
    );

    expect(affected).toBe(2);
    expect(createQueryBuilder).toHaveBeenCalledWith(WagerTransaction);
    expect(update).toHaveBeenCalledWith({ _nextReferenceAttemptAt: at, _updatedAt: at });
    expect(where).toHaveBeenCalledWith({
      providerId: 'provider-a',
      referenceExternalTransactionId: 'tx-1',
      _status: WagerTransactionStatus.PendingReference,
      _nextReferenceAttemptAt: { $gt: at },
    });
    expect(execute).toHaveBeenCalledWith('run');
  });
});
