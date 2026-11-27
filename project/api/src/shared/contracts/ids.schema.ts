import { z } from 'zod';

const InternalIdSchema = z.uuid({ version: 'v7' });
const ExternalIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);

export const WalletIdSchema = InternalIdSchema;
export const TransactionIdSchema = InternalIdSchema;
export const EntryIdSchema = InternalIdSchema;
export const EventIdSchema = InternalIdSchema;
export const PlayerIdSchema = z.uuid();
export const ProviderIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const ExternalTransactionIdSchema = ExternalIdSchema;
export const RoundIdSchema = ExternalIdSchema;
export const GameIdSchema = ExternalIdSchema;
export const MessageIdSchema = z.string().min(1).max(128);

export const IdempotencyKeySchema = z
  .string({ error: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9._:-]{1,255}$/)
  .meta({ example: 'provider-a:transaction-123' });
