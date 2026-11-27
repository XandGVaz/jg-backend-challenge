import { describe, expect, it } from 'bun:test';
import {
  ConcurrentReversalError,
  DuplicateTransactionError,
} from '../domain/wager-transaction.errors.js';
import { translateTransactionConstraint } from './transaction-constraints.js';

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value'), { code: '23505', constraint });
}

describe('translateTransactionConstraint', () => {
  it('translates the idempotency and external id unique constraints', () => {
    const byKey = translateTransactionConstraint(
      uniqueViolation('uq_wager_transactions_idempotency'),
    );
    const byExternal = translateTransactionConstraint(
      uniqueViolation('uq_wager_transactions_external'),
    );

    expect(byKey).toBeInstanceOf(DuplicateTransactionError);
    expect((byKey as DuplicateTransactionError).constraint).toBe('idempotency_key');
    expect((byKey as DuplicateTransactionError).code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(byExternal).toBeInstanceOf(DuplicateTransactionError);
    expect((byExternal as DuplicateTransactionError).constraint).toBe('external_transaction_id');
  });

  it('translates both reversal-once indexes into a retryable conflict', () => {
    for (const constraint of [
      'uq_wager_transactions_reversal_once',
      'uq_wager_transactions_bet_reversal_once',
    ]) {
      const translated = translateTransactionConstraint(uniqueViolation(constraint));

      expect(translated).toBeInstanceOf(ConcurrentReversalError);
      expect((translated as ConcurrentReversalError).code).toBe('CONCURRENCY_CONFLICT');
    }
  });

  it('keeps the original error as cause', () => {
    const original = uniqueViolation('uq_wager_transactions_idempotency');

    expect((translateTransactionConstraint(original) as Error).cause).toBe(original);
  });

  it('reads the pg error wrapped as cause and the sqlState field', () => {
    const pgError = Object.assign(new Error('x'), {
      sqlState: '23505',
      constraint: 'uq_wager_transactions_external',
    });
    const wrapped = new Error('driver exception', { cause: pgError });

    expect(translateTransactionConstraint(wrapped)).toBeInstanceOf(DuplicateTransactionError);
  });

  it('falls back to the constraint name in the message', () => {
    const error = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "uq_wager_transactions_idempotency"',
      ),
      { code: '23505' },
    );

    expect(translateTransactionConstraint(error)).toBeInstanceOf(DuplicateTransactionError);
  });

  it('returns unrelated errors untouched', () => {
    const otherUnique = uniqueViolation('uq_wallets_player_currency');
    const foreignKey = Object.assign(new Error('fk'), {
      code: '23503',
      constraint: 'fk_wager_transactions_wallet',
    });
    const plain = new Error('boom');

    expect(translateTransactionConstraint(otherUnique)).toBe(otherUnique);
    expect(translateTransactionConstraint(foreignKey)).toBe(foreignKey);
    expect(translateTransactionConstraint(plain)).toBe(plain);
    expect(translateTransactionConstraint('text')).toBe('text');
  });
});
