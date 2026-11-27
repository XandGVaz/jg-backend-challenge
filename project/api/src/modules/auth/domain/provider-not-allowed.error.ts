import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';

/** A identidade autenticada não pode agir em nome do provedor informado. */
export class ProviderNotAllowedError extends AppError {
  readonly kind = ErrorKind.Validation;
  readonly code = 'PROVIDER_NOT_ALLOWED';

  constructor(options?: ErrorOptions) {
    super('Provider identity is not allowed to act as this provider', [], options);
  }
}
