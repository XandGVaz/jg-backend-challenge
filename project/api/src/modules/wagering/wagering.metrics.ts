import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

export type Channel = 'http' | 'sqs' | 'scheduler';

let transactions: Counter | undefined;
let duration: Histogram | undefined;
let duplicates: Counter | undefined;

const meter = () => metrics.getMeter('wagering-api.wagering');

/** Transação finalizada nesta chamada, por canal, kind, status e failureCode (prometheus.md §6). */
export function recordTransaction(
  channel: Channel,
  kind: string,
  status: string,
  failureCode?: string,
): void {
  transactions ??= meter().createCounter('wagering.transactions', {
    description: 'Transações finalizadas por status',
    unit: '{transaction}',
  });
  transactions.add(1, {
    'wagering.channel': channel,
    'wagering.transaction.kind': kind,
    'wagering.transaction.status': status,
    ...(failureCode && { 'wagering.failure_code': failureCode }),
  });
}

/** Caso de uso inteiro, inclusive retries de lock, do início do service até o commit. */
export function recordProcessingDuration(
  channel: Channel,
  kind: string,
  status: string,
  seconds: number,
): void {
  duration ??= meter().createHistogram('wagering.transaction.processing.duration', {
    description: 'Duração do processamento de uma transação',
    unit: 's',
  });
  duration.record(seconds, {
    'wagering.channel': channel,
    'wagering.transaction.kind': kind,
    'wagering.transaction.status': status,
  });
}

export function recordDuplicate(channel: Channel, outcome: 'replay' | 'conflict'): void {
  duplicates ??= meter().createCounter('wagering.idempotency.duplicates', {
    description: 'Duplicatas detectadas pela Idempotency-Key',
    unit: '{request}',
  });
  duplicates.add(1, { 'wagering.channel': channel, 'wagering.outcome': outcome });
}
