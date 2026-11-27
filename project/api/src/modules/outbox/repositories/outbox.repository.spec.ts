import { describe, expect, it, mock } from 'bun:test';
import { LockMode, QueryOrder, type EntityManager } from '@mikro-orm/postgresql';
import { OutboxMessage } from '../domain/outbox-message.js';
import { OutboxRepository } from './outbox.repository.js';

function message(): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: 'evt-1',
    aggregateId: 'agg-1',
    eventType: 'WalletBalanceChanged',
    eventVersion: 1,
    payload: { eventId: 'evt-1' },
    occurredAt: new Date('2026-11-26T15:00:00.000Z'),
    attempts: 0,
  });
}

describe('OutboxRepository', () => {
  it('only persists, leaving the flush to the caller transaction', () => {
    const persist = mock(() => undefined);
    const flush = mock(async () => undefined);
    const repository = new OutboxRepository({ persist, flush } as unknown as EntityManager);
    const outboxMessage = message();

    repository.add(outboxMessage);

    expect(persist).toHaveBeenCalledWith(outboxMessage);
    expect(flush).not.toHaveBeenCalled();
  });

  it('claims due messages with FOR UPDATE SKIP LOCKED ordered by (next_attempt_at, occurred_at)', async () => {
    const claimed = [message()];
    const find = mock(async () => claimed);
    const repository = new OutboxRepository({ find } as unknown as EntityManager);
    const now = new Date('2026-11-26T15:01:00.000Z');

    const result = await repository.claimDue(now, 50);

    expect(result).toBe(claimed);
    expect(find).toHaveBeenCalledWith(
      OutboxMessage,
      {
        _publishedAt: null,
        $or: [{ _nextAttemptAt: null }, { _nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: [{ _nextAttemptAt: QueryOrder.ASC }, { occurredAt: QueryOrder.ASC }],
        limit: 50,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
  });

  it('reads the backlog with the oldest pending event', async () => {
    const execute = mock(async () => [{ pending: 3, oldest: '2026-11-26T15:00:00.000Z' }]);
    const em = { getConnection: () => ({ execute }) } as unknown as EntityManager;

    const backlog = await new OutboxRepository(em).backlog();

    expect(backlog).toEqual({
      pending: 3,
      oldestOccurredAt: new Date('2026-11-26T15:00:00.000Z'),
    });
  });

  it('reads an empty backlog without an oldest event', async () => {
    const execute = mock(async () => [{ pending: 0, oldest: null }]);
    const em = { getConnection: () => ({ execute }) } as unknown as EntityManager;

    const backlog = await new OutboxRepository(em).backlog();

    expect(backlog).toEqual({ pending: 0 });
  });
});
