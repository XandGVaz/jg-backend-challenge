import { AppError, ErrorKind } from './app-error.js';

/** Dependência de infraestrutura (PostgreSQL, SQS) inacessível; o cliente pode reenviar. */
export class DependencyUnavailableError extends AppError {
  readonly kind = ErrorKind.Transient;
  readonly code = 'DEPENDENCY_UNAVAILABLE';

  constructor(dependency: string, options?: ErrorOptions) {
    super(`${dependency} is unavailable`, [{ path: 'dependency', message: dependency }], options);
  }
}
