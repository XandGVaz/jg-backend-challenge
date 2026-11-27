import { EntitySchema, type EntityCtor } from '@mikro-orm/core';
import { OutboxMessage } from '../domain/outbox-message.js';

/**
/** Mapeamento da outbox; tabela, constraints e índice parcial pertencem às migrations Flyway. */
export const OutboxMessageEntity = new EntitySchema<OutboxMessage>({
  // O MikroORM hidrata a entidade sem tornar público o construtor do domínio.
  class: OutboxMessage as unknown as EntityCtor<OutboxMessage>,
  tableName: 'outbox_messages',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
    },
    aggregateId: {
      type: 'uuid',
      fieldName: 'aggregate_id',
    },
    eventType: {
      type: 'string',
      length: 100,
      fieldName: 'event_type',
    },
    eventVersion: {
      type: 'integer',
      fieldName: 'event_version',
    },
    payload: {
      type: 'json',
      columnType: 'jsonb',
    },
    occurredAt: {
      type: Date,
      columnType: 'timestamptz(3)',
      fieldName: 'occurred_at',
    },
    attempts: {
      type: 'integer',
      fieldName: 'attempts',
      accessor: '_attempts',
    },
    nextAttemptAt: {
      type: Date,
      columnType: 'timestamptz(3)',
      fieldName: 'next_attempt_at',
      accessor: '_nextAttemptAt',
      nullable: true,
    },
    traceContext: {
      type: 'json',
      columnType: 'jsonb',
      fieldName: 'trace_context',
      nullable: true,
    },
    publishedAt: {
      type: Date,
      columnType: 'timestamptz(3)',
      fieldName: 'published_at',
      accessor: '_publishedAt',
      nullable: true,
    },
  },
});
