import { describe, expect, it, mock, spyOn } from 'bun:test';
import { Logger } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { IntegrationEvent } from '../../../shared/domain/integration-event.js';
import type { QueueRegistry } from '../../../shared/messaging/queue-registry.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import type { OutboxRepository } from '../repositories/outbox.repository.js';
import { OutboxService } from './outbox.service.js';

const queueName = 'wallet-events.fifo';
const queueUrl = 'http://sqs.local/000000000000/wallet-events.fifo';
const now = new Date('2026-11-26T15:01:00.000Z');
const occurredAt = new Date('2026-11-26T15:00:00.000Z');

class SampleEvent extends IntegrationEvent<{ walletId: string }> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor() {
    super({
      aggregateId: 'agg-1',
      correlationId: 'req-1',
      occurredAt,
      data: { walletId: 'agg-1' },
    });
  }
}

function pending(id: string, aggregateId: string): OutboxMessage {
  return OutboxMessage.rehydrate({
    id,
    aggregateId,
    eventType: 'WalletBalanceChanged',
    eventVersion: 1,
    payload: { eventId: id, aggregateId, correlationId: 'req-1', data: {} },
    occurredAt,
    attempts: 0,
    nextAttemptAt: occurredAt,
  });
}

type Send = (command: SendMessageCommand) => Promise<unknown>;

function harness(due: OutboxMessage[], send: Send) {
  // O repository usa o EntityManager do contexto; o argumento da transação não importa aqui.
  const em = {
    transactional: mock(async (work: (tx: unknown) => Promise<unknown>) => work(undefined)),
  };
  const add = mock((_message: OutboxMessage) => undefined);
  const claimDue = mock(async (_now: Date, _limit: number) => due);
  const sqsSend = mock(send);
  const url = mock(async (_name: string) => queueUrl);
  const service = new OutboxService(
    em as unknown as EntityManager,
    { add, claimDue } as unknown as OutboxRepository,
    { send: sqsSend } as unknown as SQSClient,
    { url } as unknown as QueueRegistry,
    { queueName, batchSize: 50, maxAttempts: 3 },
  );

  return { service, em, add, claimDue, sqsSend, url };
}

describe('OutboxService', () => {
  it('enqueue only persists the envelope inside the caller transaction', () => {
    const { service, em, add } = harness([], async () => ({}));
    const event = new SampleEvent();

    const message = service.enqueue(event);

    expect(add).toHaveBeenCalledWith(message);
    expect(message.id).toBe(event.eventId);
    expect(message.payload).toEqual(event.toEnvelope() as unknown as Record<string, unknown>);
    expect(em.transactional).not.toHaveBeenCalled();
  });

  it('publishes due messages in one transaction with the FIFO group and deduplication ids', async () => {
    const first = pending('evt-1', 'agg-1');
    const second = pending('evt-2', 'agg-2');
    const { service, em, claimDue, sqsSend, url } = harness([first, second], async () => ({}));

    const summary = await service.publishDue(() => now);

    expect(summary).toEqual({ claimed: 2, published: 2, retried: 0 });
    expect(em.transactional).toHaveBeenCalledTimes(1);
    expect(claimDue).toHaveBeenCalledWith(now, 50);
    expect(url).toHaveBeenCalledWith(queueName);
    const command = sqsSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input.QueueUrl).toBe(queueUrl);
    expect(JSON.parse(command.input.MessageBody ?? '')).toEqual(first.payload);
    expect(command.input.MessageGroupId).toBe('agg-1');
    expect(command.input.MessageDeduplicationId).toBe('evt-1');
    expect(first.publishedAt).toBe(now);
    expect(second.publishedAt).toBe(now);
    expect(first.attempts).toBe(0);
  });

  it('reschedules a failed publication without an attempt limit and keeps the message pending', async () => {
    const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const message = pending('evt-1', 'agg-1');
    const { service } = harness([message], async () => {
      throw new Error('SQS unavailable');
    });

    try {
      const summary = await service.publishDue(() => now);

      expect(summary).toEqual({ claimed: 1, published: 0, retried: 1 });
      expect(message.isPending()).toBe(true);
      expect(message.attempts).toBe(1);
      expect(message.nextAttemptAt?.getTime() ?? 0).toBeGreaterThan(now.getTime());
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('holds later messages of an aggregate after a failure to preserve FIFO order', async () => {
    const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const failing = pending('evt-1', 'agg-1');
    const sameAggregate = pending('evt-2', 'agg-1');
    const other = pending('evt-3', 'agg-2');
    const { service, sqsSend } = harness([failing, sameAggregate, other], async (command) => {
      if (command.input.MessageDeduplicationId === 'evt-1') {
        throw new Error('SQS unavailable');
      }
      return {};
    });

    try {
      const summary = await service.publishDue(() => now);

      expect(summary).toEqual({ claimed: 3, published: 1, retried: 1 });
      expect(sqsSend).toHaveBeenCalledTimes(2);
      expect(sameAggregate.isPending()).toBe(true);
      expect(sameAggregate.attempts).toBe(0);
      expect(other.publishedAt).toBe(now);
    } finally {
      warn.mockRestore();
    }
  });

  it('does nothing and skips the queue lookup when no message is due', async () => {
    const { service, sqsSend, url } = harness([], async () => ({}));

    const summary = await service.publishDue(() => now);

    expect(summary).toEqual({ claimed: 0, published: 0, retried: 0 });
    expect(url).not.toHaveBeenCalled();
    expect(sqsSend).not.toHaveBeenCalled();
  });
});
