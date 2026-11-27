import { EntitySchema, type EntityCtor } from '@mikro-orm/core';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';

const decimal = { type: 'decimal', columnType: 'numeric(20,2)', runtimeType: 'string' } as const;

/** Mapeamento de `wallet_ledger_entries` (V1 + `wallet_version` da V2); o banco só aceita INSERT. */
export const WalletLedgerEntryEntity = new EntitySchema<WalletLedgerEntry>({
  // O MikroORM hidrata a entidade sem tornar público o construtor do domínio.
  class: WalletLedgerEntry as unknown as EntityCtor<WalletLedgerEntry>,
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    transactionId: { type: 'uuid', fieldName: 'transaction_id' },
    direction: { type: 'string', length: 6 },
    amount: { ...decimal },
    currency: { type: 'string', columnType: 'char(3)', length: 3 },
    balanceBeforeAmount: { ...decimal, fieldName: 'balance_before_amount' },
    balanceAfterAmount: { ...decimal, fieldName: 'balance_after_amount' },
    walletVersion: { type: 'integer', fieldName: 'wallet_version' },
    createdAt: { type: Date, columnType: 'timestamptz(3)', fieldName: 'created_at' },
  } as never,
});
