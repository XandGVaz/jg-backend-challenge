import { EntitySchema, type EntityCtor } from '@mikro-orm/core';
import { InboxMessage } from '../domain/inbox-message.js';

/** Mapeamento da inbox; tabela e constraints pertencem às migrations Flyway. */
export const InboxMessageEntity = new EntitySchema<InboxMessage>({
  // O MikroORM hidrata a entidade sem tornar público o construtor do domínio.
  class: InboxMessage as unknown as EntityCtor<InboxMessage>,
  tableName: 'inbox_messages',
  properties: {
    consumerName: {
      type: 'string',
      length: 64,
      fieldName: 'consumer_name',
      primary: true,
    },
    messageId: {
      type: 'string',
      length: 128,
      fieldName: 'message_id',
      primary: true,
    },
    payloadHash: {
      type: 'string',
      length: 80,
      fieldName: 'payload_hash',
    },
    receivedAt: {
      type: Date,
      columnType: 'timestamptz(3)',
      fieldName: 'received_at',
    },
    processedAt: {
      type: Date,
      columnType: 'timestamptz(3)',
      fieldName: 'processed_at',
      accessor: '_processedAt',
      nullable: true,
    },
  },
});
