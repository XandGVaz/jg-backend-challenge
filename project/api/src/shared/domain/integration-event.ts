import { newId } from './id.js';

export interface IntegrationEventProps<T extends Record<string, unknown>> {
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt?: Date;
  eventId?: string;
  data: T;
}

export interface EventEnvelope<T extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  version: number;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  data: T;
}

/** Envelope estável persistido na outbox e publicado para os consumidores. */
export abstract class IntegrationEvent<T extends Record<string, unknown>> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: T;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId ?? newId();
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAt = props.occurredAt ?? new Date();
    this.data = props.data;
  }

  toEnvelope(): EventEnvelope<T> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId === undefined ? {} : { causationId: this.causationId }),
      occurredAt: this.occurredAt.toISOString(),
      data: this.data,
    };
  }

  toJSON(): EventEnvelope<T> {
    return this.toEnvelope();
  }
}
