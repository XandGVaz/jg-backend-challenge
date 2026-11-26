import { metrics, type Counter } from '@opentelemetry/api';
import { MessageOutcome, type HandlerResult } from './message-handler.js';

let sqsMessages: Counter | undefined;

function sqsMessagesCounter(): Counter {
  sqsMessages ??= metrics
    .getMeter('wagering-api.messaging')
    .createCounter('wagering.sqs.messages', {
      description: 'Mensagens SQS por destino (ack, retry, dlq)',
      unit: '{message}',
    });
  return sqsMessages;
}

/** Registrado depois que a mensagem foi apagada, devolvida ou enviada para a DLQ. */
export function recordSqsMessage(queue: string, result: HandlerResult): void {
  sqsMessagesCounter().add(1, {
    'messaging.destination.name': queue,
    'wagering.outcome': result.outcome,
    ...(result.outcome === MessageOutcome.DeadLetter && { 'wagering.reason': result.reason }),
  });
}
