import { describe, expect, it, mock } from 'bun:test';
import { FailureCode } from '../../../shared/domain/failure-code.js';
import { ErrorKind } from '../../../shared/errors/app-error.js';
import { Round } from '../domain/round.js';
import { RoundClosedError } from '../domain/round-closed.error.js';
import { RoundRepository } from '../repositories/round.repository.js';
import { RoundsService } from './rounds.service.js';

function fakeRepository(round: Round | null) {
  const findForUpdate = mock(async (): Promise<Round | null> => round);
  const add = mock(async (opened: Round): Promise<Round> => opened);
  const repository = { findForUpdate, add } as unknown as RoundRepository;
  return { repository, findForUpdate, add };
}

describe('RoundsService', () => {
  it('opens a missing round and allows its first bet', async () => {
    const { repository, add } = fakeRepository(null);
    const service = new RoundsService(repository);

    await service.assertBetAllowed('provider-a', 'round-1', new Date());

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('refuses a bet on a closed round with ROUND_CLOSED', async () => {
    const round = Round.open('provider-a', 'round-1', new Date('2026-01-01T00:00:00.000Z'));
    round.close(new Date('2026-01-01T00:01:00.000Z'));
    const { repository, add } = fakeRepository(round);
    const service = new RoundsService(repository);

    const error = await service
      .assertBetAllowed('provider-a', 'round-1', new Date('2026-01-01T00:02:00.000Z'))
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RoundClosedError);
    expect(error).toMatchObject({ kind: ErrorKind.BusinessRule, code: FailureCode.RoundClosed });
    expect(add).not.toHaveBeenCalled();
  });

  it('opens and closes a round on its first result', async () => {
    const { repository, add } = fakeRepository(null);
    const service = new RoundsService(repository);
    const closedAt = new Date('2026-01-01T00:01:00.000Z');

    await service.registerResult('provider-a', 'round-1', closedAt);

    const round = add.mock.calls[0]?.[0];
    expect(round?.isClosed()).toBe(true);
    expect(round?.closedAt).toBe(closedAt);
  });

  it.each(['WIN', 'LOSS', 'REFUND', 'ROLLBACK'])(
    'allows %s after the round is closed',
    async () => {
      const firstClosedAt = new Date('2026-01-01T00:01:00.000Z');
      const round = Round.open('provider-a', 'round-1', new Date('2026-01-01T00:00:00.000Z'));
      round.close(firstClosedAt);
      const { repository } = fakeRepository(round);
      const service = new RoundsService(repository);

      await service.registerResult('provider-a', 'round-1', new Date('2026-01-01T00:02:00.000Z'));

      expect(round.closedAt).toBe(firstClosedAt);
    },
  );

  it('does not fail when concurrent callers touch the same missing round', async () => {
    let stored: Round | undefined;
    const findForUpdate = mock(async (): Promise<Round | null> => {
      await Promise.resolve();
      return stored ?? null;
    });
    const add = mock(async (opened: Round): Promise<Round> => {
      await Promise.resolve();
      stored ??= opened;
      return stored;
    });
    const repository = { findForUpdate, add } as unknown as RoundRepository;
    const firstCaller = new RoundsService(repository);
    const secondCaller = new RoundsService(repository);
    const at = new Date('2026-01-01T00:00:00.000Z');

    await Promise.all([
      firstCaller.assertBetAllowed('provider-a', 'round-1', at),
      secondCaller.assertBetAllowed('provider-a', 'round-1', at),
    ]);

    expect(add).toHaveBeenCalledTimes(2);
    expect(stored?.isClosed()).toBe(false);
  });
});
