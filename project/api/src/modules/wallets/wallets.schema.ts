import { z } from 'zod';
import {
  EntryIdSchema,
  PlayerIdSchema,
  TransactionIdSchema,
  WalletIdSchema,
} from '../../shared/contracts/ids.schema.js';
import { LedgerDirectionSchema } from '../../shared/contracts/kinds.schema.js';
import { MoneySchema, SignedMoneySchema } from '../../shared/contracts/money.schema.js';

export const CreateWalletRequestSchema = z
  .object({ playerId: PlayerIdSchema, initialBalance: MoneySchema })
  .strict()
  .meta({ id: 'CreateWalletRequest' });

export const WalletIdParamsSchema = z
  .object({ walletId: WalletIdSchema })
  .strict()
  .meta({ id: 'WalletIdParams' });

export const LedgerPageQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(512)
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .meta({ id: 'LedgerPageQuery' });

export const WalletViewSchema = z
  .object({
    id: WalletIdSchema,
    playerId: PlayerIdSchema,
    balance: MoneySchema,
    version: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'WalletView' });

export const LedgerEntryViewSchema = z
  .object({
    id: EntryIdSchema,
    transactionId: TransactionIdSchema,
    direction: LedgerDirectionSchema,
    money: MoneySchema,
    balanceBefore: MoneySchema,
    balanceAfter: MoneySchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'LedgerEntryView' });

export const LedgerPageSchema = z
  .object({ items: z.array(LedgerEntryViewSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'LedgerPage' });

export const ReconciliationReportSchema = z
  .object({
    walletId: WalletIdSchema,
    storedBalance: MoneySchema,
    calculatedBalance: SignedMoneySchema,
    difference: SignedMoneySchema,
    consistent: z.boolean(),
    checkedEntries: z.number().int().min(0),
    checkedAt: z.iso.datetime(),
  })
  .meta({ id: 'ReconciliationReport' });

export type CreateWalletRequest = z.infer<typeof CreateWalletRequestSchema>;
export type WalletIdParams = z.infer<typeof WalletIdParamsSchema>;
export type LedgerPageQuery = z.infer<typeof LedgerPageQuerySchema>;
export type WalletView = z.infer<typeof WalletViewSchema>;
export type LedgerEntryView = z.infer<typeof LedgerEntryViewSchema>;
export type LedgerPage = z.infer<typeof LedgerPageSchema>;
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;
