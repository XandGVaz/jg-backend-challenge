import { describe, expect, it } from 'bun:test';
import { SubmitTransactionRequestSchema } from './wagering.schema.js';

const base = {
  providerId: 'provider-a',
  externalTransactionId: 'tx-1',
  playerId: '00000000-0000-4000-8000-000000000001',
  walletId: '0192f2a0-0000-7000-8000-000000000001',
  roundId: 'r1',
  gameId: 'g1',
  money: { amount: '10.00', currency: 'BRL' },
};

const valid = (body: Record<string, unknown>) =>
  SubmitTransactionRequestSchema.safeParse(body).success;

describe('SubmitTransactionRequestSchema', () => {
  it('requires a reference for REFUND and ROLLBACK', () => {
    expect(valid({ ...base, kind: 'REFUND' })).toBe(false);
    expect(valid({ ...base, kind: 'ROLLBACK' })).toBe(false);
    expect(valid({ ...base, kind: 'REFUND', referenceExternalTransactionId: 'bet-1' })).toBe(true);
  });

  it('refuses a reference on BET and LOSS, and accepts it optionally on WIN', () => {
    expect(valid({ ...base, kind: 'BET', referenceExternalTransactionId: 'x' })).toBe(false);
    expect(valid({ ...base, kind: 'LOSS', referenceExternalTransactionId: 'x' })).toBe(false);
    expect(valid({ ...base, kind: 'WIN' })).toBe(true);
    expect(valid({ ...base, kind: 'WIN', referenceExternalTransactionId: 'bet-1' })).toBe(true);
  });

  it('never accepts OPENING, unknown fields or a number as money', () => {
    expect(valid({ ...base, kind: 'OPENING' })).toBe(false);
    expect(valid({ ...base, kind: 'BET', extra: true })).toBe(false);
    expect(valid({ ...base, kind: 'BET', money: { amount: 10, currency: 'BRL' } })).toBe(false);
  });
});
