import { metrics, type Counter } from '@opentelemetry/api';

let reconciliationRuns: Counter | undefined;

function reconciliationRunsCounter(): Counter {
  reconciliationRuns ??= metrics
    .getMeter('wagering-api.wallets')
    .createCounter('wagering.reconciliation.runs', {
      description: 'Reconciliações executadas, por resultado',
      unit: '{run}',
    });
  return reconciliationRuns;
}

export function recordReconciliation(consistent: boolean): void {
  reconciliationRunsCounter().add(1, { 'wagering.reconciliation.consistent': consistent });
}
