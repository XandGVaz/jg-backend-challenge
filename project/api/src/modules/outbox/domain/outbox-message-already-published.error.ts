import { AppError, ErrorKind } from '../../../shared/errors/app-error.js';

/** Transição sobre um evento já publicado: indica falha do publisher, nunca do cliente. */
export class OutboxMessageAlreadyPublishedError extends AppError {
  readonly kind = ErrorKind.Internal;
  readonly code = 'OUTBOX_MESSAGE_ALREADY_PUBLISHED';

  constructor(outboxId: string, options?: ErrorOptions) {
    super(`Outbox message ${outboxId} is already published`, [], options);
  }
}
