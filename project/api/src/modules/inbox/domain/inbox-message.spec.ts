import { describe, expect, it } from 'bun:test';
import { InboxMessage } from './inbox-message.js';

const receivedAt = new Date('2026-11-26T15:00:00.000Z');

function receive(): InboxMessage {
  return InboxMessage.receive({
    messageId: 'msg-123',
    consumerName: 'wager-transactions',
    payloadHash: 'v1:abc',
    receivedAt,
  });
}

describe('InboxMessage', () => {
  it('receives a pending message with its persistent identity and payload hash', () => {
    const message = receive();

    expect(message.messageId).toBe('msg-123');
    expect(message.consumerName).toBe('wager-transactions');
    expect(message.payloadHash).toBe('v1:abc');
    expect(message.receivedAt).toBe(receivedAt);
    expect(message.processedAt).toBeUndefined();
    expect(message.isProcessed()).toBe(false);
  });

  it('rehydrates an already processed message', () => {
    const processedAt = new Date('2026-11-26T15:01:00.000Z');
    const message = InboxMessage.rehydrate({
      messageId: 'msg-123',
      consumerName: 'wager-transactions',
      payloadHash: 'v1:abc',
      receivedAt,
      processedAt,
    });

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toBe(processedAt);
  });

  it('marks a pending message as processed', () => {
    const message = receive();
    const processedAt = new Date('2026-11-26T15:02:00.000Z');

    message.markProcessed(processedAt);

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toBe(processedAt);
  });
});
