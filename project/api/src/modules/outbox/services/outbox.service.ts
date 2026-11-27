import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SendMessageCommand, SQSClient, type MessageAttributeValue } from '@aws-sdk/client-sqs';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Link,
} from '@opentelemetry/api';
import { runTransaction } from '../../../database/run-transaction.js';
import type { TransactionUseCase } from '../../../database/database.metrics.js';
import type { IntegrationEvent } from '../../../shared/domain/integration-event.js';
import { QueueRegistry } from '../../../shared/messaging/queue-registry.js';
import { withCorrelationId } from '../../../observability/http-telemetry.middleware.js';
import { OutboxMessage, type TraceCarrier } from '../domain/outbox-message.js';
import {
  recordOutboxPublish,
  registerOutboxBacklogGauges,
  type OutboxPublishOutcome,
} from '../outbox.metrics.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';

export const OUTBOX_PUBLISHER_OPTIONS = Symbol('OUTBOX_PUBLISHER_OPTIONS');

export interface OutboxPublisherOptions {
  /** Fila FIFO de destino (env SQS_WALLET_EVENTS_QUEUE, ESCOLHAS #28). */
  queueName: string;
  /** Lote pequeno limita o tempo em que a transação segura as linhas (ESCOLHAS #20). */
  batchSize: number;
  /** env OPTIMISTIC_LOCK_MAX_ATTEMPTS, repassado ao runTransaction. */
  maxAttempts: number;
}

export const DEFAULT_OUTBOX_BATCH_SIZE = 50;

export interface OutboxPublishSummary {
  claimed: number;
  published: number;
  retried: number;
}

interface PublishResult {
  eventType: string;
  outcome: OutboxPublishOutcome;
  delaySeconds?: number;
}

interface BatchResult {
  claimed: number;
  items: PublishResult[];
}

// TODO(integrador): incluir 'publish_outbox' em TransactionUseCase e em docs/prometheus.md §5.
const PUBLISH_USE_CASE = 'publish_outbox' as TransactionUseCase;

const tracer = trace.getTracer('wagering-api.outbox');

@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxRepository,
    private readonly sqs: SQSClient,
    private readonly queues: QueueRegistry,
    @Inject(OUTBOX_PUBLISHER_OPTIONS) private readonly options: OutboxPublisherOptions,
  ) {}

  onModuleInit(): void {
    registerOutboxBacklogGauges(() => this.readBacklog());
  }

  /** Só persiste: o INSERT entra na transação aberta pelo caso de uso chamador. */
  enqueue<T extends Record<string, unknown>>(event: IntegrationEvent<T>): OutboxMessage {
    const message = OutboxMessage.enqueue(event, captureTraceContext());
    this.outbox.add(message);
    return message;
  }

  /** Um ciclo do publisher: reserva, publica e grava o resultado numa única transação. */
  publishDue(now: () => Date = () => new Date()): Promise<OutboxPublishSummary> {
    return tracer.startActiveSpan(
      'outbox.poll',
      { kind: SpanKind.INTERNAL, root: true },
      async (span) => {
        try {
          const results = await runTransaction(
            this.em,
            { useCase: PUBLISH_USE_CASE, maxAttempts: this.options.maxAttempts },
            () => this.publishBatch(now),
          );
          span.setAttribute('wagering.outbox.batch_size', results.claimed);
          // Métricas só depois do commit: antes dele o resultado ainda pode ser desfeito.
          for (const result of results.items) {
            recordOutboxPublish(result.eventType, result.outcome, result.delaySeconds);
          }
          return summarize(results.claimed, results.items);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          span.recordException(failure);
          span.setStatus({ code: SpanStatusCode.ERROR, message: failure.name });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async publishBatch(now: () => Date): Promise<BatchResult> {
    const due = await this.outbox.claimDue(now(), this.options.batchSize);
    const queueUrl = due.length === 0 ? '' : await this.queues.url(this.options.queueName);
    const blocked = new Set<string>();
    const items: PublishResult[] = [];

    for (const message of due) {
      // Depois de uma falha, o agregado espera o próximo ciclo para não inverter a ordem FIFO.
      if (blocked.has(message.aggregateId)) {
        continue;
      }

      const result = await this.publishOne(message, queueUrl, now);

      if (result.outcome === 'retry_scheduled') {
        blocked.add(message.aggregateId);
      }

      items.push(result);
    }

    return { claimed: due.length, items };
  }

  private publishOne(
    message: OutboxMessage,
    queueUrl: string,
    now: () => Date,
  ): Promise<PublishResult> {
    return tracer.startActiveSpan(
      `${this.options.queueName} publish`,
      {
        kind: SpanKind.PRODUCER,
        links: storedLinks(message.traceContext),
        attributes: {
          'messaging.system': 'aws_sqs',
          'messaging.destination.name': this.options.queueName,
          'messaging.operation.type': 'send',
          'wagering.outbox.id': message.id,
          'wagering.event.type': message.eventType,
          'wagering.attempt': message.attempts + 1,
        },
      },
      async (span): Promise<PublishResult> => {
        try {
          await this.sqs.send(
            new SendMessageCommand({
              QueueUrl: queueUrl,
              MessageBody: JSON.stringify(message.payload),
              MessageGroupId: message.aggregateId,
              MessageDeduplicationId: message.id,
              MessageAttributes: producerAttributes(correlationIdOf(message)),
            }),
          );
          const publishedAt = now();
          message.markPublished(publishedAt);
          return {
            eventType: message.eventType,
            outcome: 'published',
            delaySeconds: (publishedAt.getTime() - message.occurredAt.getTime()) / 1000,
          };
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          message.scheduleRetry(now());
          span.recordException(failure);
          span.setStatus({ code: SpanStatusCode.ERROR, message: failure.name });
          span.addEvent('outbox.retry_scheduled', {
            'wagering.attempt': message.attempts,
          });
          this.logger.warn({
            message: 'Outbox publish failed, retry scheduled',
            outboxId: message.id,
            eventType: message.eventType,
            attempt: message.attempts,
            nextAttemptAt: message.nextAttemptAt?.toISOString(),
            error: failure.name,
          });
          return { eventType: message.eventType, outcome: 'retry_scheduled' };
        } finally {
          span.end();
        }
      },
    );
  }

  private async readBacklog(): Promise<{ pending: number; lagSeconds: number }> {
    try {
      const backlog = await this.outbox.backlog();
      const lagMs = backlog.oldestOccurredAt
        ? Math.max(0, Date.now() - backlog.oldestOccurredAt.getTime())
        : 0;
      return { pending: backlog.pending, lagSeconds: lagMs / 1000 };
    } catch (error) {
      this.logger.warn({
        message: 'Outbox backlog read failed',
        error: error instanceof Error ? error.name : String(error),
      });
      return { pending: 0, lagSeconds: 0 };
    }
  }
}

function summarize(claimed: number, items: PublishResult[]): OutboxPublishSummary {
  const published = items.filter((item) => item.outcome === 'published').length;
  return { claimed, published, retried: items.length - published };
}

// Contexto ativo do caso de uso, serializado para o publisher ligar o PRODUCER por link.
function captureTraceContext(): TraceCarrier | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length === 0 ? undefined : carrier;
}

function storedLinks(traceContext: TraceCarrier | undefined): Link[] {
  if (!traceContext) {
    return [];
  }

  const spanContext = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, traceContext));

  if (!spanContext) {
    return [];
  }

  return [{ context: spanContext }];
}

function correlationIdOf(message: OutboxMessage): string | undefined {
  const correlationId = message.payload.correlationId;
  return typeof correlationId === 'string' ? correlationId : undefined;
}

// O consumer extrai traceparent, tracestate e baggage dos MessageAttributes (docs/jaeger.md §6).
function producerAttributes(
  correlationId: string | undefined,
): Record<string, MessageAttributeValue> {
  const carrier: Record<string, string> = {};
  const attributes: Record<string, MessageAttributeValue> = {};
  propagation.inject(withCorrelationId(context.active(), correlationId), carrier);

  for (const [key, value] of Object.entries(carrier)) {
    attributes[key] = { DataType: 'String', StringValue: value };
  }

  return attributes;
}
