import { describe, expect, it } from 'bun:test';
import { FailureCode } from './failure-code.js';

describe('FailureCode', () => {
  it('has exactly the 13 codes of api.md section 10, in the same order', () => {
    const values: string[] = Object.values(FailureCode);

    expect(values).toEqual([
      'INSUFFICIENT_FUNDS',
      'REVERSAL_INSUFFICIENT_FUNDS',
      'CURRENCY_MISMATCH',
      'WALLET_PLAYER_MISMATCH',
      'REFERENCE_NOT_FOUND',
      'REFERENCE_MISMATCH',
      'REFERENCE_KIND_NOT_ALLOWED',
      'REFERENCE_NOT_PROCESSED',
      'REFERENCE_ALREADY_REVERSED',
      'REVERSAL_AMOUNT_MISMATCH',
      'BET_ALREADY_CANCELLED',
      'ROUND_CLOSED',
      'PROCESSING_RETRIES_EXHAUSTED',
    ]);
  });

  it('matches the format of the DB CHECK ck_wager_transactions_failure_code', () => {
    const pattern = /^[A-Z][A-Z0-9_]*$/;

    for (const code of Object.values(FailureCode)) {
      expect(code).toMatch(pattern);
    }
  });

  it('has no duplicate values', () => {
    const values = Object.values(FailureCode);

    expect(new Set(values).size).toBe(values.length);
  });
});
