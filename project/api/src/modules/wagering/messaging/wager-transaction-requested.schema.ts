import { z } from 'zod';
import { IdempotencyKeySchema, MessageIdSchema } from '../../../shared/contracts/ids.schema.js';
import { SubmitTransactionFields, checkReferenceRules } from '../wagering.schema.js';

/** Mensagem de entrada da fila wager-transactions.fifo (api.md §12.1); `data` reusa o body HTTP. */
export const WagerTransactionRequestedSchema = z
  .object({
    messageId: MessageIdSchema,
    type: z.literal('WagerTransactionRequested'),
    occurredAt: z.iso.datetime(),
    data: SubmitTransactionFields.extend({ idempotencyKey: IdempotencyKeySchema })
      .strict()
      .superRefine(checkReferenceRules),
  })
  .strict();

export type WagerTransactionRequested = z.infer<typeof WagerTransactionRequestedSchema>;
