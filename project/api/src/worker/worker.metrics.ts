import { metrics, type Counter } from '@opentelemetry/api';

let reprocessed: Counter | undefined;

export type ReprocessOutcome = 'processed' | 'still_pending' | 'expired' | 'rejected';

/** Resultado de cada PENDING_REFERENCE retomada pelo agendador (prometheus.md §6). */
export function recordReprocessed(outcome: ReprocessOutcome): void {
  reprocessed ??= metrics
    .getMeter('wagering-api.wagering')
    .createCounter('wagering.pending_reference.reprocessed', {
      description: 'Transações PENDING_REFERENCE reprocessadas, por resultado',
      unit: '{transaction}',
    });
  reprocessed.add(1, { 'wagering.outcome': outcome });
}
