import { z } from 'zod';
import {
  ExternalTransactionIdSchema,
  GameIdSchema,
  IdempotencyKeySchema,
  PlayerIdSchema,
  ProviderIdSchema,
  RoundIdSchema,
  TransactionIdSchema,
  WalletIdSchema,
} from '../../shared/contracts/ids.schema.js';
import {
  SubmittableKindSchema,
  TransactionKindSchema,
  TransactionStatusSchema,
} from '../../shared/contracts/kinds.schema.js';
import { MoneySchema } from '../../shared/contracts/money.schema.js';

const REFERENCE_REQUIRED = new Set(['REFUND', 'ROLLBACK']);
const REFERENCE_FORBIDDEN = new Set(['BET', 'LOSS']);

/** Campos de negócio do submit; os mesmos formam o payloadHash (api.md §9.3, §9.5). */
export const SubmitTransactionFields = z.object({
  providerId: ProviderIdSchema,
  externalTransactionId: ExternalTransactionIdSchema,
  playerId: PlayerIdSchema,
  walletId: WalletIdSchema,
  roundId: RoundIdSchema,
  gameId: GameIdSchema,
  kind: SubmittableKindSchema,
  money: MoneySchema,
  referenceExternalTransactionId: ExternalTransactionIdSchema.optional(),
});

type ReferenceFields = { kind: string; referenceExternalTransactionId?: string | undefined };

/** Referência exigida em REFUND/ROLLBACK e recusada em BET/LOSS, valendo para o HTTP e a fila. */
export function checkReferenceRules(value: ReferenceFields, ctx: z.RefinementCtx): void {
  const hasReference = value.referenceExternalTransactionId !== undefined;

  if (REFERENCE_REQUIRED.has(value.kind) && !hasReference) {
    ctx.addIssue({
      code: 'custom',
      path: ['referenceExternalTransactionId'],
      message: `${value.kind} requires referenceExternalTransactionId`,
    });
  }

  // LOSS com referência é 400, não failureCode: o CHECK do banco também a recusa (ESCOLHAS #21).
  if (REFERENCE_FORBIDDEN.has(value.kind) && hasReference) {
    ctx.addIssue({
      code: 'custom',
      path: ['referenceExternalTransactionId'],
      message: `${value.kind} does not accept referenceExternalTransactionId`,
    });
  }
}

export const SubmitTransactionRequestSchema = SubmitTransactionFields.strict()
  .superRefine(checkReferenceRules)
  .meta({ id: 'SubmitTransactionRequest' });

/** Headers validados como objeto, sem `.strict()`: os demais headers são ignorados (api.md §9.4). */
export const SubmitTransactionHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema });

export const SubmitTransactionResponseSchema = z
  .object({
    transactionId: TransactionIdSchema,
    status: TransactionStatusSchema,
    balance: MoneySchema,
    idempotentReplay: z.boolean(),
  })
  .meta({ id: 'SubmitTransactionResponse' });

export const TransactionViewSchema = z
  .object({
    id: TransactionIdSchema,
    providerId: ProviderIdSchema,
    externalTransactionId: ExternalTransactionIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    walletId: WalletIdSchema,
    playerId: PlayerIdSchema,
    roundId: RoundIdSchema,
    gameId: GameIdSchema,
    kind: TransactionKindSchema,
    money: MoneySchema,
    status: TransactionStatusSchema,
    referenceExternalTransactionId: ExternalTransactionIdSchema.optional(),
    referenceTransactionId: TransactionIdSchema.optional(),
    failureCode: z.string().optional(),
    createdAt: z.iso.datetime(),
    processedAt: z.iso.datetime().optional(),
  })
  .meta({ id: 'TransactionView' });

export const TransactionIdParamsSchema = z
  .object({ transactionId: TransactionIdSchema })
  .strict()
  .meta({ id: 'TransactionIdParams' });

export const ProviderTransactionParamsSchema = z
  .object({ providerId: ProviderIdSchema, externalTransactionId: ExternalTransactionIdSchema })
  .strict()
  .meta({ id: 'ProviderTransactionParams' });

export type SubmitTransactionRequest = z.infer<typeof SubmitTransactionRequestSchema>;
export type SubmitTransactionResponse = z.infer<typeof SubmitTransactionResponseSchema>;
export type TransactionView = z.infer<typeof TransactionViewSchema>;
export type TransactionIdParams = z.infer<typeof TransactionIdParamsSchema>;
export type ProviderTransactionParams = z.infer<typeof ProviderTransactionParamsSchema>;
