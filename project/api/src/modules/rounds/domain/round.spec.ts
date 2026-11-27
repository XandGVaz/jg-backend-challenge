import { describe, expect, it } from 'bun:test';
import { Round, RoundStatus } from './round.js';

describe('Round', () => {
  it('opens with the provider identity and opening timestamp', () => {
    const openedAt = new Date('2026-01-01T00:00:00.000Z');

    const round = Round.open('provider-a', 'round-1', openedAt);

    expect(round.providerId).toBe('provider-a');
    expect(round.roundId).toBe('round-1');
    expect(round.status).toBe(RoundStatus.Open);
    expect(round.openedAt).toBe(openedAt);
    expect(round.closedAt).toBeUndefined();
    expect(round.isClosed()).toBe(false);
  });

  it('closes once and preserves the first closing timestamp', () => {
    const round = Round.open('provider-a', 'round-1', new Date('2026-01-01T00:00:00.000Z'));
    const closedAt = new Date('2026-01-01T00:01:00.000Z');

    expect(round.close(closedAt)).toBe(true);
    expect(round.status).toBe(RoundStatus.Closed);
    expect(round.closedAt).toBe(closedAt);
    expect(round.isClosed()).toBe(true);

    expect(round.close(new Date('2026-01-01T00:02:00.000Z'))).toBe(false);
    expect(round.closedAt).toBe(closedAt);
  });

  it('rehydrates a closed round without replaying its transition', () => {
    const closedAt = new Date('2026-01-01T00:01:00.000Z');

    const round = Round.rehydrate({
      providerId: 'provider-a',
      roundId: 'round-1',
      status: RoundStatus.Closed,
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
      closedAt,
    });

    expect(round.isClosed()).toBe(true);
    expect(round.closedAt).toBe(closedAt);
  });
});
