import { describe, expect, it } from 'bun:test';
import {
  LedgerDirectionSchema,
  SubmittableKindSchema,
  TransactionKindSchema,
  TransactionStatusSchema,
} from './kinds.schema.js';

describe('kind schemas', () => {
  it('never accepts the internal OPENING kind as input', () => {
    for (const kind of ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']) {
      expect(SubmittableKindSchema.safeParse(kind).success).toBe(true);
    }

    expect(SubmittableKindSchema.safeParse('OPENING').success).toBe(false);
    expect(TransactionKindSchema.safeParse('OPENING').success).toBe(true);
    expect(TransactionKindSchema.options).toEqual([
      'OPENING',
      'BET',
      'WIN',
      'LOSS',
      'REFUND',
      'ROLLBACK',
    ]);
  });

  it('exposes the transaction statuses and ledger directions from api.md', () => {
    expect(TransactionStatusSchema.options).toEqual([
      'PENDING',
      'PENDING_REFERENCE',
      'PROCESSED',
      'REJECTED',
      'FAILED',
    ]);
    expect(LedgerDirectionSchema.options).toEqual(['DEBIT', 'CREDIT']);
    expect(TransactionStatusSchema.safeParse('UNKNOWN').success).toBe(false);
    expect(LedgerDirectionSchema.safeParse('credit').success).toBe(false);
  });
});
