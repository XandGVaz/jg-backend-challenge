import { EntitySchema, type EntityCtor } from '@mikro-orm/core';
import { Round, RoundStatus } from '../domain/round.js';

// O ORM hidrata pelo protótipo, sem invocar o construtor privado do domínio.
const RoundEntityClass = Round as unknown as EntityCtor<Round>;

export const RoundEntitySchema = new EntitySchema<Round>({
  class: RoundEntityClass,
  tableName: 'rounds',
  properties: {
    providerId: { primary: true, type: 'string', length: 64, fieldName: 'provider_id' },
    roundId: { primary: true, type: 'string', length: 128, fieldName: 'round_id' },
    status: {
      enum: true,
      items: () => Object.values(RoundStatus),
      columnType: 'varchar(10)',
      fieldName: 'status',
      accessor: '_status',
    },
    openedAt: { type: Date, columnType: 'timestamptz(3)', fieldName: 'opened_at' },
    closedAt: {
      type: Date,
      columnType: 'timestamptz(3)',
      fieldName: 'closed_at',
      nullable: true,
      accessor: '_closedAt',
    },
  },
});
