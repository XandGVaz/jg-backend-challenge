import { describe, expect, it } from 'bun:test';
import { IntegrationEvent } from '../../../shared/domain/integration-event.js';
import { OutboxMessage } from './outbox-message.js';
import { OutboxMessageAlreadyPublishedError } from './outbox-message-already-published.error.js';

class SampleEvent extends IntegrationEvent<{ walletId: string }> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(occurredAt: Date) {
    super({
      eventId: '0192f2a0-0000-7000-8000-000000000001',
      aggregateId: '0192f2a0-0000-7000-8000-0000000000aa',
      correlationId: 'req-1',
      causationId: 'tx-1',
      occurredAt,
      data: { walletId: '0192f2a0-0000-7000-8000-0000000000aa' },
    });
  }
}

const occurredAt = new Date('2026-11-26T15:00:00.000Z');

function pending(nextAttemptAt?: Date, attempts = 0): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: 'evt-1',
    aggregateId: 'agg-1',
    eventType: 'WalletBalanceChanged',
    eventVersion: 1,
    payload: { eventId: 'evt-1' },
    occurredAt,
    attempts,
    nextAttemptAt,
  });
}

describe('OutboxMessage', () => {
  it('enqueues the event envelope as payload with the eventId as id', () => {
    const event = new SampleEvent(occurredAt);
    const carrier = { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' };

    const message = OutboxMessage.enqueue(event, carrier);

    expect(message.id).toBe(event.eventId);
    expect(message.aggregateId).toBe(event.aggregateId);
    expect(message.eventType).toBe('WalletBalanceChanged');
    expect(message.eventVersion).toBe(1);
    expect(message.payload).toEqual(event.toEnvelope() as unknown as Record<string, unknown>);
    expect(message.occurredAt).toBe(occurredAt);
    expect(message.attempts).toBe(0);
    expect(message.nextAttemptAt).toBe(occurredAt);
    expect(message.publishedAt).toBeUndefined();
    expect(message.traceContext).toBe(carrier);
    expect(message.isPending()).toBe(true);
  });

  it('is due when pending and the next attempt has arrived', () => {
    const message = pending(new Date('2026-11-26T15:00:10.000Z'));

    expect(message.isDue(new Date('2026-11-26T15:00:09.999Z'))).toBe(false);
    expect(message.isDue(new Date('2026-11-26T15:00:10.000Z'))).toBe(true);
  });

  it('is due when pending without a scheduled attempt', () => {
    expect(pending().isDue(occurredAt)).toBe(true);
  });

  it('is never due once published', () => {
    const message = pending(occurredAt);
    message.markPublished(new Date('2026-11-26T15:00:01.000Z'));

    expect(message.isPending()).toBe(false);
    expect(message.isDue(new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('marks published at the supplied instant and rejects a second publication', () => {
    const message = pending(occurredAt);
    const at = new Date('2026-11-26T15:00:01.000Z');

    message.markPublished(at);

    expect(message.publishedAt).toBe(at);
    expect(() => message.markPublished(at)).toThrow(OutboxMessageAlreadyPublishedError);
  });

  it('schedules a retry with exponential backoff and increments attempts', () => {
    const message = pending(occurredAt);
    const now = new Date('2026-11-26T15:01:00.000Z');

    // random = 1 leva ao teto do intervalo: 2 s na primeira tentativa, 4 s na segunda.
    message.scheduleRetry(now, () => 1);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date('2026-11-26T15:01:02.000Z'));

    message.scheduleRetry(now, () => 1);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(new Date('2026-11-26T15:01:04.000Z'));
    expect(message.isDue(now)).toBe(false);
  });

  it('keeps retrying without an attempt limit, capped at 300 seconds', () => {
    const message = pending(occurredAt, 99);
    const now = new Date('2026-11-26T15:01:00.000Z');

    message.scheduleRetry(now, () => 1);

    expect(message.attempts).toBe(100);
    expect(message.nextAttemptAt).toEqual(new Date('2026-11-26T15:06:00.000Z'));
    expect(message.isPending()).toBe(true);
  });

  it('rejects scheduling a retry for a published message', () => {
    const message = pending(occurredAt);
    message.markPublished(occurredAt);

    expect(() => message.scheduleRetry(occurredAt)).toThrow(OutboxMessageAlreadyPublishedError);
  });
});
