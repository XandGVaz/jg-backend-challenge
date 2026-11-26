import { Logger } from '@nestjs/common';
import {
  ChangeMessageVisibilityBatchCommand,
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
  type MessageAttributeValue,
} from '@aws-sdk/client-sqs';
import { propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  CORRELATION_ID_BAGGAGE_KEY,
  withCorrelationId,
} from '../../observability/http-telemetry.middleware.js';
import { AppError, ErrorKind } from '../errors/index.js';
import {
  MessageOutcome,
  type HandlerResult,
  type MessageHandler,
  type ReceivedMessage,
} from './message-handler.js';
import { recordSqsMessage } from './messaging.metrics.js';
import type { QueueRegistry } from './queue-registry.js';
import { retryDelaySeconds } from './retry-backoff.js';

const tracer = trace.getTracer('wagering-api.messaging');

export const DLQ_REASON_ATTRIBUTE = 'wagering-dlq-reason';

export interface SqsPollerOptions {
  queueName: string;
  deadLetterQueueName: string;
  waitTimeSeconds: number;
  maxMessages: number;
  handler: MessageHandler;
}

/*
    Long polling de uma fila FIFO. Mensagens do mesmo MessageGroupId (a wallet) são processadas
    em ordem, uma por vez; grupos diferentes rodam em paralelo. O ack (DeleteMessage) só acontece
    depois que o handler retorna, ou seja, depois do commit do caso de uso.
*/
export class SqsPoller {
  private readonly logger = new Logger(SqsPoller.name);
  private readonly abort = new AbortController();
  private running: Promise<void> | undefined;

  constructor(
    private readonly sqs: SQSClient,
    private readonly queues: QueueRegistry,
    private readonly options: SqsPollerOptions,
  ) {}

  start(): void {
    if (this.running) {
      this.logger.debug({ message: 'Queue consumer already running', queue: this.queue });
      return;
    }

    this.running = this.loop();
    this.logger.log({ message: 'Queue consumer started', queue: this.queue });
  }

  /** SIGTERM: para de receber, termina as mensagens em andamento e devolve as que não começaram. */
  async stop(): Promise<void> {
    if (!this.running) {
      this.logger.debug({ message: 'Queue consumer not running', queue: this.queue });
      return;
    }

    this.abort.abort();
    await this.running;
    this.running = undefined;
    this.logger.log({ message: 'Queue consumer stopped', queue: this.queue });
  }

  private get queue(): string {
    return this.options.queueName;
  }

  private get stopping(): boolean {
    return this.abort.signal.aborted;
  }

  private async loop(): Promise<void> {
    let failures = 0;

    while (!this.stopping) {
      const messages = await this.receive();

      if (messages === undefined) {
        failures += 1;
        await pause(retryDelaySeconds(failures) * 1000, this.abort.signal);
        continue;
      }

      failures = 0;

      if (messages.length === 0) {
        this.logger.debug({ message: 'No messages received', queue: this.queue });
        continue;
      }

      await this.processBatch(messages);
    }
  }

  /** `undefined` = falha ao receber (fila fora do ar); `[]` = nada na fila ou parando. */
  private async receive(): Promise<Message[] | undefined> {
    try {
      const output = await this.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: await this.queues.url(this.queue),
          MaxNumberOfMessages: this.options.maxMessages,
          WaitTimeSeconds: this.options.waitTimeSeconds,
          MessageAttributeNames: ['All'],
          MessageSystemAttributeNames: ['ApproximateReceiveCount', 'MessageGroupId'],
        }),
        { abortSignal: this.abort.signal },
      );
      return output.Messages ?? [];
    } catch (error) {
      if (this.stopping) {
        this.logger.debug({ message: 'Receive aborted by shutdown', queue: this.queue });
        return [];
      }

      this.logger.warn({
        message: 'Queue receive failed',
        queue: this.queue,
        errorName: toError(error).name,
      });
      return undefined;
    }
  }

  private async processBatch(messages: Message[]): Promise<void> {
    const groups = new Map<string, Message[]>();

    for (const message of messages) {
      const groupId = message.Attributes?.MessageGroupId ?? '';
      groups.set(groupId, [...(groups.get(groupId) ?? []), message]);
    }

    const outcomes = await Promise.all(
      [...groups.values()].map((group) => this.processGroup(group)),
    );
    const settled = outcomes.flat();

    this.logger.log({
      message: 'Message batch processed',
      queue: this.queue,
      received: messages.length,
      acked: settled.filter((outcome) => outcome === MessageOutcome.Ack).length,
      retried: settled.filter((outcome) => outcome === MessageOutcome.Retry).length,
      deadLettered: settled.filter((outcome) => outcome === MessageOutcome.DeadLetter).length,
    });
  }

  private async processGroup(group: Message[]): Promise<MessageOutcome[]> {
    const outcomes: MessageOutcome[] = [];

    for (const [index, message] of group.entries()) {
      if (this.stopping) {
        await this.release(group.slice(index), 'shutdown');
        return outcomes;
      }

      const outcome = await this.process(message);
      outcomes.push(outcome);

      // A próxima do grupo só pode ser aplicada depois desta, senão a ordem da wallet quebra.
      if (outcome === MessageOutcome.Retry) {
        await this.release(group.slice(index + 1), 'group_blocked');
        return outcomes;
      }
    }

    return outcomes;
  }

  private process(raw: Message): Promise<MessageOutcome> {
    const message = toReceivedMessage(raw);
    const extracted = propagation.extract(ROOT_CONTEXT, message.attributes);
    const hasCorrelation = propagation.getBaggage(extracted)?.getEntry(CORRELATION_ID_BAGGAGE_KEY);
    const parent = hasCorrelation ? extracted : withCorrelationId(extracted, message.sqsMessageId);

    return tracer.startActiveSpan(
      `${this.queue} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'aws_sqs',
          'messaging.destination.name': this.queue,
          'messaging.operation.type': 'process',
          'messaging.message.id': message.sqsMessageId,
          'wagering.sqs.receive_count': message.receiveCount,
        },
      },
      parent,
      async (span) => {
        try {
          const result = await this.invoke(message);
          span.setAttribute('wagering.outcome', result.outcome);

          if (result.outcome === MessageOutcome.DeadLetter) {
            span.setAttribute('wagering.reason', result.reason);
          }

          if (result.outcome === MessageOutcome.Retry) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'retry' });
          }

          await this.settle(raw, message, result);
          recordSqsMessage(this.queue, result);
          return result.outcome;
        } catch (error) {
          // Ack/retry/DLQ falharam: a mensagem volta sozinha quando o visibility timeout vencer.
          span.recordException(toError(error));
          span.setStatus({ code: SpanStatusCode.ERROR, message: toError(error).name });
          this.logger.error(
            {
              message: 'Message settle failed',
              queue: this.queue,
              messageId: message.sqsMessageId,
            },
            toStack(error),
          );
          return MessageOutcome.Retry;
        } finally {
          span.end();
        }
      },
    );
  }

  private async invoke(message: ReceivedMessage): Promise<HandlerResult> {
    try {
      return await this.options.handler(message);
    } catch (error) {
      const span = trace.getActiveSpan();
      span?.recordException(toError(error));

      if (error instanceof AppError && error.kind === ErrorKind.Transient) {
        this.logger.warn({
          message: 'Message failed transiently',
          queue: this.queue,
          messageId: message.sqsMessageId,
          attempt: message.receiveCount,
          code: error.code,
        });
        return { outcome: MessageOutcome.Retry };
      }

      this.logger.error(
        {
          message: 'Message handler failed',
          queue: this.queue,
          messageId: message.sqsMessageId,
          attempt: message.receiveCount,
        },
        toStack(error),
      );
      return { outcome: MessageOutcome.Retry };
    }
  }

  private async settle(
    raw: Message,
    message: ReceivedMessage,
    result: HandlerResult,
  ): Promise<void> {
    const queueUrl = await this.queues.url(this.queue);

    switch (result.outcome) {
      case MessageOutcome.Ack:
        await this.sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: raw.ReceiptHandle }),
        );
        this.logger.debug({
          message: 'Message acked',
          queue: this.queue,
          messageId: message.sqsMessageId,
        });
        return;

      case MessageOutcome.Retry: {
        const delay = retryDelaySeconds(message.receiveCount);
        await this.sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: raw.ReceiptHandle,
            VisibilityTimeout: delay,
          }),
        );
        this.logger.warn({
          message: 'Message retry scheduled',
          queue: this.queue,
          messageId: message.sqsMessageId,
          attempt: message.receiveCount,
          delaySeconds: delay,
        });
        return;
      }

      case MessageOutcome.DeadLetter:
        // Envia antes de apagar: se o delete falhar, a deduplicação FIFO evita a cópia na DLQ.
        await this.sqs.send(
          new SendMessageCommand({
            QueueUrl: await this.queues.url(this.options.deadLetterQueueName),
            MessageBody: raw.Body ?? '',
            MessageGroupId: message.groupId,
            MessageDeduplicationId: message.sqsMessageId,
            MessageAttributes: {
              ...raw.MessageAttributes,
              [DLQ_REASON_ATTRIBUTE]: { DataType: 'String', StringValue: result.reason },
            },
          }),
        );
        await this.sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: raw.ReceiptHandle }),
        );
        this.logger.error({
          message: 'Message sent to DLQ',
          queue: this.queue,
          messageId: message.sqsMessageId,
          attempt: message.receiveCount,
          reason: result.reason,
        });
        return;
    }
  }

  /** Visibilidade 0: a mensagem volta para a fila na hora (conta mais uma entrega no SQS). */
  private async release(messages: Message[], reason: 'shutdown' | 'group_blocked'): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    try {
      await this.sqs.send(
        new ChangeMessageVisibilityBatchCommand({
          QueueUrl: await this.queues.url(this.queue),
          Entries: messages.map((message, index) => ({
            Id: String(index),
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 0,
          })),
        }),
      );
      this.logger.debug({
        message: 'Messages released',
        queue: this.queue,
        count: messages.length,
        reason,
      });
    } catch (error) {
      // Sem a devolução elas voltam sozinhas depois do visibility timeout da fila.
      this.logger.warn({
        message: 'Message release failed',
        queue: this.queue,
        count: messages.length,
        reason,
        errorName: toError(error).name,
      });
    }
  }
}

function toReceivedMessage(message: Message): ReceivedMessage {
  return {
    sqsMessageId: message.MessageId ?? '',
    body: message.Body ?? '',
    groupId: message.Attributes?.MessageGroupId ?? '',
    receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
    attributes: toStringAttributes(message.MessageAttributes),
  };
}

function toStringAttributes(
  attributes: Record<string, MessageAttributeValue> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value.DataType === 'String' && value.StringValue !== undefined) {
      result[key] = value.StringValue;
    }
  }

  return result;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function toStack(error: unknown): string | undefined {
  return toError(error).stack;
}
