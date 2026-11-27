import { describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { Round, RoundStatus } from '../domain/round.js';
import { roundsEntities } from './index.js';
import { RoundEntitySchema } from './round.entity.js';

describe('RoundEntitySchema', () => {
  it('maps the composite key and every column of the rounds table', () => {
    RoundEntitySchema.init();
    const properties = RoundEntitySchema.properties;

    expect(RoundEntitySchema.tableName).toBe('rounds');
    expect(properties.providerId.fieldNames).toEqual(['provider_id']);
    expect(properties.providerId.primary).toBe(true);
    expect(properties.roundId.fieldNames).toEqual(['round_id']);
    expect(properties.roundId.primary).toBe(true);
    expect(properties.status.fieldNames).toEqual(['status']);
    expect(properties.status.accessor).toBe('_status');
    expect(properties.openedAt.fieldNames).toEqual(['opened_at']);
    expect(properties.closedAt.fieldNames).toEqual(['closed_at']);
    expect(properties.closedAt.nullable).toBe(true);
    expect(properties.closedAt.accessor).toBe('_closedAt');
    expect(roundsEntities).toEqual([RoundEntitySchema]);
  });

  it('generates insert-or-get with the mapped columns and composite key', async () => {
    const orm = new MikroORM({
      clientUrl: 'postgresql://user:pass@localhost:5432/wagering',
      entities: [RoundEntitySchema],
    });

    try {
      const openedAt = new Date('2026-01-01T00:00:00.000Z');
      const round = Round.open('provider-a', 'round-1', openedAt);
      const query = orm.em
        .createQueryBuilder(Round)
        .insert(round)
        .onConflict(['providerId', 'roundId'])
        .ignore();

      expect(query.getQuery()).toBe(
        'insert into "rounds" ("provider_id", "round_id", "status", "opened_at") values (?, ?, ?, ?) on conflict ("provider_id", "round_id") do nothing',
      );
      expect(query.getParams()).toEqual(['provider-a', 'round-1', RoundStatus.Open, openedAt]);
    } finally {
      await orm.close();
    }
  });
});
