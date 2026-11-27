import { describe, expect, it } from 'bun:test';
import { newId } from './id.js';
import {
  IntegrationEvent,
  type EventEnvelope,
  type IntegrationEventProps,
} from './integration-event.js';

type TestEventData = {
  transactionId: string;
  money: { amount: string; currency: string };
};

class TestEvent extends IntegrationEvent<TestEventData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(props: IntegrationEventProps<TestEventData>) {
    super(props);
  }
}

describe('IntegrationEvent', () => {
  it('serializes the exact api.md envelope with an ISO occurredAt', () => {
    const eventId = newId();
    const aggregateId = newId();
    const causationId = newId();
    const occurredAt = new Date('2026-07-29T15:00:00.000Z');
    const data: TestEventData = {
      transactionId: newId(),
      money: { amount: '25.00', currency: 'BRL' },
    };
    const event = new TestEvent({
      eventId,
      aggregateId,
      correlationId: 'request-123',
      causationId,
      occurredAt,
      data,
    });

    const expected: EventEnvelope<TestEventData> = {
      eventId,
      eventType: 'WalletBalanceChanged',
      version: 1,
      aggregateId,
      correlationId: 'request-123',
      causationId,
      occurredAt: '2026-07-29T15:00:00.000Z',
      data,
    };

    expect(event.toEnvelope()).toEqual(expected);
    expect(Object.keys(event.toEnvelope())).toEqual([
      'eventId',
      'eventType',
      'version',
      'aggregateId',
      'correlationId',
      'causationId',
      'occurredAt',
      'data',
    ]);
    expect(JSON.stringify(event)).toBe(JSON.stringify(expected));
  });

  it('generates eventId and occurredAt and omits absent optional fields', () => {
    const before = Date.now();
    const event = new TestEvent({
      aggregateId: newId(),
      correlationId: 'message-123',
      data: { transactionId: newId(), money: { amount: '0.00', currency: 'BRL' } },
    });
    const after = Date.now();
    const envelope = event.toEnvelope();

    expect(envelope.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(envelope.occurredAt).toBe(event.occurredAt.toISOString());
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after);
    expect('causationId' in envelope).toBe(false);
  });
});
