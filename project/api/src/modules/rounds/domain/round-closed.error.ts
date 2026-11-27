import { FailureCode } from '../../../shared/domain/failure-code.js';
import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';

/** Apostas não são aceitas depois que a rodada foi fechada por um resultado. */
export class RoundClosedError extends AppError {
  readonly kind = ErrorKind.BusinessRule;
  readonly code = FailureCode.RoundClosed;

  constructor(providerId: string, roundId: string, options?: ErrorOptions) {
    super(`Round ${roundId} is closed for provider ${providerId}`, [], options);
  }
}
