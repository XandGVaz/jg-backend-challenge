import type { AppError } from '../../../shared/errors/app-error.js';
import {
  ConcurrentReversalError,
  DuplicateTransactionError,
} from '../domain/wager-transaction.errors.js';

const UNIQUE_VIOLATION = '23505';
const CONSTRAINT_IN_MESSAGE = /constraint "([a-z0-9_]+)"/;

/** Constraints de `wager_transactions` (V1) com erro de aplicação próprio. */
const TRANSLATIONS: Readonly<Record<string, (cause: unknown) => AppError>> = {
  uq_wager_transactions_idempotency: (cause) =>
    new DuplicateTransactionError('idempotency_key', { cause }),
  uq_wager_transactions_external: (cause) =>
    new DuplicateTransactionError('external_transaction_id', { cause }),
  uq_wager_transactions_reversal_once: (cause) => new ConcurrentReversalError({ cause }),
  uq_wager_transactions_bet_reversal_once: (cause) => new ConcurrentReversalError({ cause }),
};

interface PgErrorShape {
  code?: unknown;
  sqlState?: unknown;
  constraint?: unknown;
  message?: unknown;
  cause?: unknown;
}

/**
 * Traduz a violação de unicidade de `wager_transactions` pelo nome da constraint; qualquer outro
 * erro volta intacto. Vale no `insert` do repository e no commit do caso de uso chamador.
 */
export function translateTransactionConstraint(error: unknown): unknown {
  const constraint = uniqueViolationConstraint(error);

  if (constraint === undefined) {
    return error;
  }

  const translate = TRANSLATIONS[constraint];

  if (translate === undefined) {
    return error;
  }

  return translate(error);
}

// O MikroORM embrulha o erro do `pg`; os campos podem estar no próprio erro ou na causa.
function uniqueViolationConstraint(error: unknown): string | undefined {
  for (const candidate of [error, causeOf(error)]) {
    if (!isUniqueViolation(candidate)) {
      continue;
    }

    const constraint = constraintOf(candidate);

    if (constraint !== undefined) {
      return constraint;
    }
  }

  return undefined;
}

function isUniqueViolation(value: unknown): value is PgErrorShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const shape = value as PgErrorShape;
  return shape.code === UNIQUE_VIOLATION || shape.sqlState === UNIQUE_VIOLATION;
}

function constraintOf(shape: PgErrorShape): string | undefined {
  if (typeof shape.constraint === 'string') {
    return shape.constraint;
  }

  if (typeof shape.message !== 'string') {
    return undefined;
  }

  return CONSTRAINT_IN_MESSAGE.exec(shape.message)?.[1];
}

function causeOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  return (error as PgErrorShape).cause;
}
