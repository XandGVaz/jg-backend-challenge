import { context, propagation } from '@opentelemetry/api';
import { CORRELATION_ID_BAGGAGE_KEY } from './http-telemetry.middleware.js';

/** correlationId do contexto ativo (X-Request-Id no HTTP, messageId no SQS), lido do baggage. */
export function currentCorrelationId(): string | undefined {
  return propagation.getBaggage(context.active())?.getEntry(CORRELATION_ID_BAGGAGE_KEY)?.value;
}
