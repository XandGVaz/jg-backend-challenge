import { describe, expect, it, mock, spyOn } from 'bun:test';
import { Logger } from '@nestjs/common';
import { InboxMessage } from '../domain/inbox-message.js';
import { InboxRepository } from '../repositories/inbox.repository.js';
import { InboxService } from './inbox.service.js';

const consumerName = 'wager-transactions';
const messageId = 'msg-123';
const payloadHash = 'v1:original';
const receivedAt = new Date('2026-11-26T15:00:00.000Z');

function existingMessage(processedAt?: Date, storedPayloadHash = payloadHash): InboxMessage {
  return InboxMessage.rehydrate({
    consumerName,
    messageId,
    payloadHash: storedPayloadHash,
    receivedAt,
    processedAt,
  });
}

function createService(inserted: boolean, existing: InboxMessage = existingMessage()) {
  const insert = mock(async (_message: InboxMessage) => inserted);
  const get = mock(async (_consumerName: string, _messageId: string) => existing);
  const repository = { insert, get } as unknown as InboxRepository;

  return { service: new InboxService(repository), insert, get };
}

describe('InboxService', () => {
  it('receives a new message inside the caller unit of work', async () => {
    const { service, insert, get } = createService(true);

    const result = await service.receive(consumerName, messageId, payloadHash);

    expect(result).toBe('new');
    expect(insert).toHaveBeenCalledTimes(1);
    const message = insert.mock.calls[0][0] as InboxMessage;
    expect(message).toBeInstanceOf(InboxMessage);
    expect(message.consumerName).toBe(consumerName);
    expect(message.messageId).toBe(messageId);
    expect(message.payloadHash).toBe(payloadHash);
    expect(message.receivedAt).toBeInstanceOf(Date);
    expect(get).not.toHaveBeenCalled();
  });

  it('classifies a processed duplicate', async () => {
    const existing = existingMessage(new Date('2026-11-26T15:01:00.000Z'));
    const { service } = createService(false, existing);

    const result = await service.receive(consumerName, messageId, payloadHash);

    expect(result).toBe('duplicate-processed');
  });

  it('classifies a pending duplicate', async () => {
    const { service } = createService(false, existingMessage());

    const result = await service.receive(consumerName, messageId, payloadHash);

    expect(result).toBe('duplicate-pending');
  });

  it('treats a payload hash mismatch on the same messageId as duplicate and logs warn', async () => {
    const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service } = createService(false, existingMessage());

    try {
      const result = await service.receive(consumerName, messageId, 'v1:different');

      expect(result).toBe('duplicate-pending');
      expect(warn).toHaveBeenCalledWith({
        message: 'Inbox duplicate payload hash mismatch',
        consumerName,
        messageId,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('marks an existing message as processed at the supplied instant', async () => {
    const existing = existingMessage();
    const { service, get } = createService(false, existing);
    const processedAt = new Date('2026-11-26T15:02:00.000Z');

    await service.markProcessed(consumerName, messageId, processedAt);

    expect(get).toHaveBeenCalledWith(consumerName, messageId);
    expect(existing.processedAt).toBe(processedAt);
    expect(existing.isProcessed()).toBe(true);
  });
});
