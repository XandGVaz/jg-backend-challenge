import { describe, expect, it, mock } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessage } from '../domain/inbox-message.js';
import { InboxRepository } from './inbox.repository.js';

function message(): InboxMessage {
  return InboxMessage.receive({
    consumerName: 'wager-transactions',
    messageId: 'msg-123',
    payloadHash: 'v1:abc',
    receivedAt: new Date('2026-11-26T15:00:00.000Z'),
  });
}

function insertHarness(affectedRows: number) {
  const execute = mock(async () => ({ affectedRows }));
  const ignore = mock(() => ({ execute }));
  const onConflict = mock(() => ({ ignore }));
  const insert = mock(() => ({ onConflict }));
  const em = { createQueryBuilder: mock(() => ({ insert })) } as unknown as EntityManager;

  return { repository: new InboxRepository(em), execute, ignore, onConflict, insert };
}

describe('InboxRepository', () => {
  it('inserts a new message and protects the caller transaction with ON CONFLICT DO NOTHING', async () => {
    const { repository, execute, ignore, onConflict, insert } = insertHarness(1);
    const inboxMessage = message();

    const inserted = await repository.insert(inboxMessage);

    expect(inserted).toBe(true);
    expect(insert).toHaveBeenCalledWith(inboxMessage);
    expect(onConflict).toHaveBeenCalledWith(['consumerName', 'messageId']);
    expect(ignore).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('run');
  });

  it('translates a primary key collision into not inserted', async () => {
    const { repository } = insertHarness(0);

    const inserted = await repository.insert(message());

    expect(inserted).toBe(false);
  });

  it('loads a message by the composite primary key', async () => {
    const inboxMessage = message();
    const findOneOrFail = mock(async () => inboxMessage);
    const em = { findOneOrFail } as unknown as EntityManager;
    const repository = new InboxRepository(em);

    const found = await repository.get('wager-transactions', 'msg-123');

    expect(found).toBe(inboxMessage);
    expect(findOneOrFail).toHaveBeenCalledWith(InboxMessage, {
      consumerName: 'wager-transactions',
      messageId: 'msg-123',
    });
  });
});
