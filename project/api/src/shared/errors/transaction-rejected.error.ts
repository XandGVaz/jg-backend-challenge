import { AppError, ErrorKind } from './app-error.js';

/**
 * Rejeição de negócio já gravada: lançada só depois do commit, com o failureCode como `code` e o
 * `transactionId` no corpo do 422 (api.md §11, ESCOLHAS #16).
 */
export class TransactionRejectedError extends AppError {
  readonly kind = ErrorKind.BusinessRule;
  readonly code: string;

  constructor(
    failureCode: string,
    readonly transactionId: string,
    options?: ErrorOptions,
  ) {
    super(`Wager transaction rejected: ${failureCode}`, [], options);
    this.code = failureCode;
  }
}
