import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { E2E } from './env.js';

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: E2E.sqsEndpoint,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const urls = new Map<string, string>();

async function url(queue: string): Promise<string> {
  const cached = urls.get(queue);
  if (cached) return cached;
  const output = await sqs.send(new GetQueueUrlCommand({ QueueName: queue }));
  urls.set(queue, output.QueueUrl!);
  return output.QueueUrl!;
}

/** Envia o corpo como chega de um provedor; a deduplicação do FIFO usa o id informado. */
export async function sendRaw(
  body: string,
  groupId: string,
  deduplicationId: string,
): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: await url('wager-transactions.fifo'),
      MessageBody: body,
      MessageGroupId: groupId,
      MessageDeduplicationId: deduplicationId,
    }),
  );
}

export async function approximateCount(queue: string): Promise<number> {
  const output = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: await url(queue),
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return Number(output.Attributes?.ApproximateNumberOfMessages ?? 0);
}

/** Lê (sem apagar) mensagens da DLQ e devolve o motivo gravado pelo worker. */
export async function peekDeadLetters(): Promise<{ body: string; reason?: string }[]> {
  const output = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: await url('wager-transactions-dlq.fifo'),
      MaxNumberOfMessages: 10,
      MessageAttributeNames: ['All'],
      VisibilityTimeout: 0,
      WaitTimeSeconds: 1,
    }),
  );
  return (output.Messages ?? []).map((message) => ({
    body: message.Body ?? '',
    reason: message.MessageAttributes?.['wagering-dlq-reason']?.StringValue,
  }));
}
