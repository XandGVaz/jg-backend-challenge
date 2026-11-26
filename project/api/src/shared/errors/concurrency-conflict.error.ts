import { AppError, ErrorKind } from './app-error.js';

/** Conflito de bloqueio otimista que persistiu em todas as tentativas; nada foi gravado e o cliente pode reenviar. */
export class ConcurrencyConflictError extends AppError {
  readonly kind = ErrorKind.Transient;
  readonly code = 'CONCURRENCY_CONFLICT';

  constructor(useCase: string, attempts: number, options?: ErrorOptions) {
    super(
      `Concurrent update conflict persisted after ${attempts} attempts`,
      [{ path: 'useCase', message: useCase }],
      options,
    );
  }
}
