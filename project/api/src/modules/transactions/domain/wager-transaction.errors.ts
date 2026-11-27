import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';
import type { WagerTransactionKind } from './wager-transaction-kind.js';
import type { WagerTransactionStatus } from './wager-transaction-status.js';

/** Transição fora da tabela de ESCOLHAS #13: erro de programação, não caminho de negócio. */
export class InvalidTransactionStateError extends AppError {
  readonly kind = ErrorKind.Internal;
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(
    readonly transactionId: string,
    readonly from: WagerTransactionStatus,
    readonly operation: string,
    options?: ErrorOptions,
  ) {
    super(
      `Wager transaction ${transactionId} cannot ${operation} from status ${from}`,
      [{ path: 'status', message: `Invalid from ${from}` }],
      options,
    );
  }
}

/** Referência exigida ausente ou referência proibida presente para o kind (api.md §9.3). */
export class InvalidTransactionReferenceError extends AppError {
  readonly kind = ErrorKind.Validation;
  readonly code = 'REQUEST_VALIDATION_FAILED';

  constructor(transactionKind: WagerTransactionKind, required: boolean, options?: ErrorOptions) {
    const message = required
      ? `${transactionKind} requires referenceExternalTransactionId`
      : `${transactionKind} does not accept referenceExternalTransactionId`;
    super(message, [{ path: 'referenceExternalTransactionId', message }], options);
  }
}

/** Pedido de sentido de lançamento para uma combinação sem efeito no saldo ou não permitida. */
export class LedgerDirectionUnavailableError extends AppError {
  readonly kind = ErrorKind.Internal;
  readonly code = 'LEDGER_DIRECTION_UNAVAILABLE';

  constructor(
    transactionKind: WagerTransactionKind,
    referenceKind: WagerTransactionKind | undefined,
    options?: ErrorOptions,
  ) {
    const target = referenceKind === undefined ? 'without reference' : `of ${referenceKind}`;
    super(`${transactionKind} ${target} has no ledger direction`, [], options);
  }
}

/** Transação inexistente consultada por id interno ou por id do provedor. */
export class TransactionNotFoundError extends AppError {
  readonly kind = ErrorKind.NotFound;
  readonly code = 'TRANSACTION_NOT_FOUND';

  constructor(path: string, options?: ErrorOptions) {
    super('Wager transaction not found', [{ path, message: 'Not found' }], options);
  }
}

/** Unicidade da transação violada (`idempotency_key` ou `provider_id` + `external_transaction_id`). */
export class DuplicateTransactionError extends AppError {
  readonly kind = ErrorKind.Conflict;
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT';

  constructor(
    readonly constraint: 'idempotency_key' | 'external_transaction_id',
    options?: ErrorOptions,
  ) {
    const path = constraint === 'idempotency_key' ? 'idempotency-key' : 'externalTransactionId';
    super(
      'A wager transaction with the same identity already exists',
      [{ path, message: 'Already exists' }],
      options,
    );
  }
}

/** Duas reversões da mesma referência no mesmo instante; a perdedora pode refazer a transação inteira. */
export class ConcurrentReversalError extends AppError {
  readonly kind = ErrorKind.Transient;
  readonly code = 'CONCURRENCY_CONFLICT';

  constructor(options?: ErrorOptions) {
    super(
      'Concurrent reversal of the same reference',
      [{ path: 'referenceExternalTransactionId', message: 'Reversed concurrently' }],
      options,
    );
  }
}
