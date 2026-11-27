import { EntitySchema, type EntityCtor } from '@mikro-orm/core';
import { WagerTransaction } from '../domain/wager-transaction.js';

const timestamp = { type: Date, columnType: 'timestamptz(3)' } as const;
const decimal = { type: 'decimal', columnType: 'numeric(20,2)', runtimeType: 'string' } as const;
const currency = { type: 'string', columnType: 'char(3)', length: 3 } as const;

/**
 * Mapeamento de `wager_transactions` (V1); schema, constraints e guard
 * pertencem às migrations Flyway. Valores monetários trafegam como string decimal, nunca number.
 */
export const WagerTransactionEntity = new EntitySchema<WagerTransaction>({
  // O MikroORM hidrata a entidade sem tornar público o construtor do domínio.
  class: WagerTransaction as unknown as EntityCtor<WagerTransaction>,
  tableName: 'wager_transactions',
  // Os campos privados (`_amount`, `_currency`...) não são chaves públicas do tipo do domínio.
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'string', length: 64, fieldName: 'provider_id' },
    externalTransactionId: { type: 'string', length: 128, fieldName: 'external_transaction_id' },
    idempotencyKey: { type: 'string', length: 255, fieldName: 'idempotency_key' },
    payloadHash: { type: 'string', length: 80, fieldName: 'payload_hash' },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    playerId: { type: 'uuid', fieldName: 'player_id' },
    roundId: { type: 'string', length: 128, fieldName: 'round_id' },
    gameId: { type: 'string', length: 128, fieldName: 'game_id' },
    kind: { type: 'string', length: 16 },
    amount: { ...decimal, accessor: '_amount' },
    currency: { ...currency, accessor: '_currency' },
    referenceExternalTransactionId: {
      type: 'string',
      length: 128,
      fieldName: 'reference_external_transaction_id',
      nullable: true,
    },
    referenceTransactionId: {
      type: 'uuid',
      fieldName: 'reference_transaction_id',
      accessor: '_referenceTransactionId',
      nullable: true,
    },
    referenceKind: {
      type: 'string',
      length: 16,
      fieldName: 'reference_kind',
      accessor: '_referenceKind',
      nullable: true,
    },
    status: { type: 'string', length: 20, accessor: '_status' },
    failureCode: {
      type: 'string',
      length: 64,
      fieldName: 'failure_code',
      accessor: '_failureCode',
      nullable: true,
    },
    resultBalanceAmount: {
      ...decimal,
      fieldName: 'result_balance_amount',
      accessor: '_resultBalanceAmount',
      nullable: true,
    },
    resultBalanceCurrency: {
      ...currency,
      fieldName: 'result_balance_currency',
      accessor: '_resultBalanceCurrency',
      nullable: true,
    },
    referenceAttempts: {
      type: 'integer',
      fieldName: 'reference_attempts',
      accessor: '_referenceAttempts',
    },
    nextReferenceAttemptAt: {
      ...timestamp,
      fieldName: 'next_reference_attempt_at',
      accessor: '_nextReferenceAttemptAt',
      nullable: true,
    },
    createdAt: { ...timestamp, fieldName: 'created_at' },
    updatedAt: {
      ...timestamp,
      fieldName: 'updated_at',
      accessor: '_updatedAt',
      onUpdate: () => new Date(),
    },
    processedAt: {
      ...timestamp,
      fieldName: 'processed_at',
      accessor: '_processedAt',
      nullable: true,
    },
  } as never,
});
