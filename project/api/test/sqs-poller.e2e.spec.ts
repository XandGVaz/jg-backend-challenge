import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { MessageOutcome, type MessageHandler } from '../src/shared/messaging/message-handler.js';
import { QueueRegistry } from '../src/shared/messaging/queue-registry.js';
import { createSqsClient } from '../src/shared/messaging/sqs.module.js';
import { DLQ_REASON_ATTRIBUTE, SqsPoller } from '../src/shared/messaging/sqs-poller.js';

// Contra o SQS real do emulador (MiniStack): `SQS_ENDPOINT=http://localhost:4566 bun test test`.
const endpoint = process.env.SQS_ENDPOINT;
const suffix = Date.now().toString(36);
const queueName = `poller-${suffix}.fifo`;
const dlqName = `poller-dlq-${suffix}.fifo`;

describe.skipIf(!endpoint)('SqsPoller (MiniStack)', () => {
  let sqs: SQSClient;
  let queues: QueueRegistry;
  let poller: SqsPoller | undefined;
  let sequence = 0;

  beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID ??= 'test';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
    sqs = createSqsClient({ AWS_REGION: 'us-east-1', SQS_ENDPOINT: endpoint });
    queues = new QueueRegistry(sqs, [queueName, dlqName]);

    for (const name of [queueName, dlqName]) {
      await sqs.send(
        new CreateQueueCommand({
          QueueName: name,
          Attributes: { FifoQueue: 'true', VisibilityTimeout: '30' },
        }),
      );
    }
  });

  afterEach(async () => {
    await poller?.stop();
    poller = undefined;
  });

  afterAll(async () => {
    for (const name of [queueName, dlqName]) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: await queues.url(name) }));
    }
    sqs.destroy();
  });

  const send = async (body: string, groupId: string): Promise<void> => {
    sequence += 1;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: await queues.url(queueName),
        MessageBody: body,
        MessageGroupId: groupId,
        MessageDeduplicationId: `${suffix}-${sequence}`,
      }),
    );
  };

  const run = (handler: MessageHandler): void => {
    poller = new SqsPoller(sqs, queues, {
      queueName,
      deadLetterQueueName: dlqName,
      waitTimeSeconds: 1,
      maxMessages: 10,
      handler,
    });
    poller.start();
  };

  const depth = async (name: string): Promise<number> => {
    const output = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: await queues.url(name),
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }),
    );
    const attributes = output.Attributes ?? {};
    return (
      Number(attributes.ApproximateNumberOfMessages) +
      Number(attributes.ApproximateNumberOfMessagesNotVisible)
    );
  };

  const until = async (condition: () => boolean, timeoutMs = 10_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error('Condition not met in time');
      }
      await Bun.sleep(50);
    }
  };

  it('acks (deletes) the message after the handler returns', async () => {
    const seen: string[] = [];
    await send('ack-me', 'wallet-ack');

    run(async (message) => {
      seen.push(message.body);
      return { outcome: MessageOutcome.Ack };
    });

    await until(() => seen.length === 1);
    await poller?.stop();

    expect(seen).toEqual(['ack-me']);
    expect(await depth(queueName)).toBe(0);
  });

  it('redelivers after a retry with a higher receive count', async () => {
    const counts: number[] = [];
    await send('retry-me', 'wallet-retry');

    run(async (message) => {
      counts.push(message.receiveCount);
      return counts.length === 1
        ? { outcome: MessageOutcome.Retry }
        : { outcome: MessageOutcome.Ack };
    });

    await until(() => counts.length === 2);

    expect(counts).toEqual([1, 2]);
  });

  it('treats a thrown error as a retry', async () => {
    let calls = 0;
    await send('throw-me', 'wallet-throw');

    run(async () => {
      calls += 1;

      if (calls === 1) {
        throw new Error('boom');
      }

      return { outcome: MessageOutcome.Ack };
    });

    await until(() => calls === 2);
  });

  it('moves the message to the DLQ with the reason attribute', async () => {
    let handled = false;
    await send('{not json', 'wallet-dlq');

    run(async () => {
      handled = true;
      return { outcome: MessageOutcome.DeadLetter, reason: 'invalid_message' };
    });

    await until(() => handled);
    await poller?.stop();

    const output = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: await queues.url(dlqName),
        MessageAttributeNames: ['All'],
        WaitTimeSeconds: 1,
      }),
    );
    const [dead] = output.Messages ?? [];

    expect(dead?.Body).toBe('{not json');
    expect(dead?.MessageAttributes?.[DLQ_REASON_ATTRIBUTE]?.StringValue).toBe('invalid_message');
    expect(await depth(queueName)).toBe(0);
  });

  it('keeps the order of a message group even when the first one is retried', async () => {
    const order: string[] = [];
    await send('first', 'wallet-order');
    await send('second', 'wallet-order');
    await send('third', 'wallet-order');

    run(async (message) => {
      order.push(message.body);
      const firstAttempt = message.body === 'first' && message.receiveCount === 1;
      return firstAttempt ? { outcome: MessageOutcome.Retry } : { outcome: MessageOutcome.Ack };
    });

    await until(() => order.filter((body) => body !== 'first').length === 2);

    expect(order).toEqual(['first', 'first', 'second', 'third']);
  });

  it('finishes the in-flight message before stopping', async () => {
    let started = false;
    let finished = false;
    await send('slow', 'wallet-slow');

    run(async () => {
      started = true;
      await Bun.sleep(500);
      finished = true;
      return { outcome: MessageOutcome.Ack };
    });

    await until(() => started);
    await poller?.stop();

    expect(finished).toBe(true);
    expect(await depth(queueName)).toBe(0);
  });
});
