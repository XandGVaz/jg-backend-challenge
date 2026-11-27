import { metrics, type Counter } from '@opentelemetry/api';

/** Valores de `wagering.use_case` (docs/prometheus.md §5). */
export type TransactionUseCase =
  'submit_transaction' | 'open_wallet' | 'reprocess_pending' | 'publish_outbox';

let lockConflicts: Counter | undefined;
let retries: Counter | undefined;

function lockConflictsCounter(): Counter {
  lockConflicts ??= metrics
    .getMeter('wagering-api.database')
    .createCounter('wagering.lock.conflicts', {
      description: 'Conflitos de bloqueio otimista (OptimisticLockError)',
      unit: '{conflict}',
    });
  return lockConflicts;
}

function retriesCounter(): Counter {
  retries ??= metrics.getMeter('wagering-api.database').createCounter('wagering.retries', {
    description: 'Novas tentativas por operação',
    unit: '{retry}',
  });
  return retries;
}

/** Cada OptimisticLockError, inclusive o da última tentativa. */
export function recordLockConflict(useCase: TransactionUseCase): void {
  lockConflictsCounter().add(1, { 'wagering.use_case': useCase });
}

/** Cada nova tentativa da transação depois de um conflito. */
export function recordLockRetry(): void {
  retriesCounter().add(1, { 'wagering.operation': 'optimistic_lock' });
}
