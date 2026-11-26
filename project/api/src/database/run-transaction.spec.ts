import { describe, expect, it, mock } from 'bun:test';
import { OptimisticLockError, type EntityManager } from '@mikro-orm/postgresql';
import { AppError, ConcurrencyConflictError, ErrorKind } from '../shared/errors/index.js';
import { runTransaction } from './run-transaction.js';

class InsufficientFundsTestError extends AppError {
  readonly kind = ErrorKind.BusinessRule;
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor() {
    super('Insufficient funds');
  }
}

function fakeEntityManager(): { em: EntityManager; transactional: ReturnType<typeof mock> } {
  const em = {} as EntityManager;
  const transactional = mock((cb: (tx: EntityManager) => Promise<unknown>) => cb(em));
  Object.assign(em, { transactional });
  return { em, transactional };
}

const options = { useCase: 'submit_transaction', maxAttempts: 3 } as const;

describe('runTransaction', () => {
  it('returns the result of the first successful attempt', async () => {
    const { em, transactional } = fakeEntityManager();

    const result = await runTransaction(em, options, async () => 'done');

    expect(result).toBe('done');
    expect(transactional).toHaveBeenCalledTimes(1);
  });

  it('retries the whole transaction after an optimistic lock conflict', async () => {
    const { em, transactional } = fakeEntityManager();
    let calls = 0;

    const result = await runTransaction(em, options, async () => {
      calls++;
      if (calls === 1) {
        throw OptimisticLockError.lockFailed('Wallet');
      }
      return calls;
    });

    expect(result).toBe(2);
    expect(transactional).toHaveBeenCalledTimes(2);
  });

  it('throws ConcurrencyConflictError when every attempt conflicts', async () => {
    const { em, transactional } = fakeEntityManager();

    const run = runTransaction(em, options, async () => {
      throw OptimisticLockError.lockFailed('Wallet');
    });

    expect(await run.catch((error: unknown) => error)).toBeInstanceOf(ConcurrencyConflictError);
    expect(transactional).toHaveBeenCalledTimes(3);
  });

  it('rethrows other errors without retrying', async () => {
    const { em, transactional } = fakeEntityManager();

    const run = runTransaction(em, options, async () => {
      throw new InsufficientFundsTestError();
    });

    expect(await run.catch((error: unknown) => error)).toBeInstanceOf(InsufficientFundsTestError);
    expect(transactional).toHaveBeenCalledTimes(1);
  });
});
