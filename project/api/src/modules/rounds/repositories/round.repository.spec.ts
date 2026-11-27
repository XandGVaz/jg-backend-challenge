import { describe, expect, it, mock } from 'bun:test';
import { LockMode, type EntityManager } from '@mikro-orm/postgresql';
import { Round } from '../domain/round.js';
import { RoundRepository } from './round.repository.js';

describe('RoundRepository', () => {
  it('locks the round row for update', async () => {
    const round = Round.open('provider-a', 'round-1', new Date());
    const findOne = mock(async () => round);
    const em = { findOne } as unknown as EntityManager;
    const repository = new RoundRepository(em);

    const found = await repository.findForUpdate('provider-a', 'round-1');

    expect(found).toBe(round);
    expect(findOne).toHaveBeenCalledWith(
      Round,
      { providerId: 'provider-a', roundId: 'round-1' },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  });

  it('inserts with conflict ignore and returns the locked persisted row', async () => {
    const openedAt = new Date('2026-01-01T00:00:00.000Z');
    const opened = Round.open('provider-a', 'round-1', openedAt);
    const persisted = Round.open('provider-a', 'round-1', openedAt);
    const queryBuilder: Record<string, unknown> = {};
    const insert = mock(() => queryBuilder);
    const onConflict = mock(() => queryBuilder);
    const ignore = mock(() => queryBuilder);
    const execute = mock(async () => ({ affectedRows: 0 }));
    Object.assign(queryBuilder, { insert, onConflict, ignore, execute });
    const createQueryBuilder = mock(() => queryBuilder);
    const findOne = mock(async () => persisted);
    const em = { createQueryBuilder, findOne } as unknown as EntityManager;
    const repository = new RoundRepository(em);

    const result = await repository.add(opened);

    expect(result).toBe(persisted);
    expect(insert).toHaveBeenCalledWith(opened);
    expect(onConflict).toHaveBeenCalledWith(['providerId', 'roundId']);
    expect(ignore).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith(
      Round,
      { providerId: 'provider-a', roundId: 'round-1' },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  });
});
