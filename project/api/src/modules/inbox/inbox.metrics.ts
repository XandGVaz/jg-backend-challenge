import { metrics, type Counter } from '@opentelemetry/api';

let inboxDuplicates: Counter | undefined;

function inboxDuplicatesCounter(): Counter {
  inboxDuplicates ??= metrics
    .getMeter('wagering-api.inbox')
    .createCounter('wagering.inbox.duplicates', {
      description: 'Duplicatas de mensagens detectadas pela inbox',
      unit: '{message}',
    });
  return inboxDuplicates;
}

export function recordInboxDuplicate(consumerName: string): void {
  inboxDuplicatesCounter().add(1, { 'wagering.consumer': consumerName });
}
