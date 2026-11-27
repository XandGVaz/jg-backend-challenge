import { z } from 'zod';

export const SubmittableKindSchema = z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']);
export const TransactionKindSchema = z.enum([
  'OPENING',
  'BET',
  'WIN',
  'LOSS',
  'REFUND',
  'ROLLBACK',
]);
export const TransactionStatusSchema = z.enum([
  'PENDING',
  'PENDING_REFERENCE',
  'PROCESSED',
  'REJECTED',
  'FAILED',
]);
export const LedgerDirectionSchema = z.enum(['DEBIT', 'CREDIT']);
