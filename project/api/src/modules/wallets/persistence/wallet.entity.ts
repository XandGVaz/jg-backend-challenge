import { EntitySchema, type EntityCtor } from '@mikro-orm/core';
import { Wallet } from '../domain/wallet.js';

const timestamp = { type: Date, columnType: 'timestamptz(3)' } as const;

/**
 * Mapeamento de `wallets`. `version` é coluna comum, não a versão automática do MikroORM: o domínio
 * incrementa a versão e o repository grava com `WHERE version = <lida>` (ESCOLHAS #4 e #12).
 */
export const WalletEntity = new EntitySchema<Wallet>({
  // O MikroORM hidrata a entidade sem tornar público o construtor do domínio.
  class: Wallet as unknown as EntityCtor<Wallet>,
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'uuid', fieldName: 'player_id' },
    currency: { type: 'string', columnType: 'char(3)', length: 3 },
    balanceAmount: {
      type: 'decimal',
      columnType: 'numeric(20,2)',
      runtimeType: 'string',
      fieldName: 'balance_amount',
      accessor: '_balanceAmount',
    },
    version: { type: 'integer', accessor: '_version' },
    createdAt: { ...timestamp, fieldName: 'created_at' },
    updatedAt: { ...timestamp, fieldName: 'updated_at', accessor: '_updatedAt' },
  } as never,
});
