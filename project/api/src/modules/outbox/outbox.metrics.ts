import {
  metrics,
  type BatchObservableCallback,
  type Counter,
  type Histogram,
} from '@opentelemetry/api';

export type OutboxPublishOutcome = 'published' | 'retry_scheduled';

export interface OutboxBacklogReading {
  pending: number;
  lagSeconds: number;
}

const METER = 'wagering-api.outbox';
const PUBLISH_DELAY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

let published: Counter | undefined;
let publishDelay: Histogram | undefined;
let retries: Counter | undefined;
let backlogRegistered = false;

function publishedCounter(): Counter {
  published ??= metrics.getMeter(METER).createCounter('wagering.outbox.published', {
    description: 'Eventos da outbox publicados ou reagendados',
    unit: '{event}',
  });
  return published;
}

function publishDelayHistogram(): Histogram {
  publishDelay ??= metrics.getMeter(METER).createHistogram('wagering.outbox.publish.delay', {
    description: 'Atraso entre o evento e a publicação no SQS',
    unit: 's',
    advice: { explicitBucketBoundaries: PUBLISH_DELAY_BUCKETS },
  });
  return publishDelay;
}

function retriesCounter(): Counter {
  retries ??= metrics.getMeter(METER).createCounter('wagering.retries', {
    description: 'Novas tentativas por operação',
    unit: '{retry}',
  });
  return retries;
}

/** Registrado depois do commit que gravou `published_at` ou o novo `next_attempt_at`. */
export function recordOutboxPublish(
  eventType: string,
  outcome: OutboxPublishOutcome,
  delaySeconds?: number,
): void {
  publishedCounter().add(1, { 'wagering.event.type': eventType, 'wagering.outcome': outcome });

  if (outcome === 'retry_scheduled') {
    retriesCounter().add(1, { 'wagering.operation': 'outbox_publish' });
    return;
  }

  if (delaySeconds !== undefined) {
    publishDelayHistogram().record(delaySeconds, { 'wagering.event.type': eventType });
  }
}

/** Gauges do backlog, lidos do banco a cada coleta; registrados uma vez por processo. */
export function registerOutboxBacklogGauges(read: () => Promise<OutboxBacklogReading>): void {
  if (backlogRegistered) {
    return;
  }

  backlogRegistered = true;
  const meter = metrics.getMeter(METER);
  const pending = meter.createObservableGauge('wagering.outbox.pending', {
    description: 'Eventos da outbox ainda não publicados',
    unit: '{event}',
  });
  const lag = meter.createObservableGauge('wagering.outbox.lag', {
    description: 'Idade do evento pendente mais antigo',
    unit: 's',
  });

  // Uma consulta por coleta alimenta os dois gauges.
  const observe: BatchObservableCallback = async (observer) => {
    const reading = await read();
    observer.observe(pending, reading.pending);
    observer.observe(lag, reading.lagSeconds);
  };
  meter.addBatchObservableCallback(observe, [pending, lag]);
}
