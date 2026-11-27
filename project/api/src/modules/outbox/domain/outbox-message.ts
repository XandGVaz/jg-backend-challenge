import type { IntegrationEvent } from '../../../shared/domain/integration-event.js';
import { retryDelaySeconds } from '../../../shared/messaging/retry-backoff.js';
import { OutboxMessageAlreadyPublishedError } from './outbox-message-already-published.error.js';

/** Portadores W3C (`traceparent`, `tracestate`, `baggage`) serializados no enqueue. */
export type TraceCarrier = Readonly<Record<string, string>>;

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
  traceContext?: TraceCarrier;
}

/** Evento de integração gravado na transação do caso de uso e publicado depois do commit. */
export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly eventVersion: number,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
    public readonly traceContext?: TraceCarrier,
  ) {}

  /** O id é o eventId: o consumidor e a deduplicação FIFO enxergam o mesmo identificador. */
  static enqueue<T extends Record<string, unknown>>(
    event: IntegrationEvent<T>,
    traceContext?: TraceCarrier,
  ): OutboxMessage {
    const envelope = event.toEnvelope();

    // nextAttemptAt preenchido desde o início mantém a busca no índice parcial.
    return new OutboxMessage(
      envelope.eventId,
      envelope.aggregateId,
      envelope.eventType,
      envelope.version,
      envelope as unknown as Readonly<Record<string, unknown>>,
      event.occurredAt,
      0,
      event.occurredAt,
      undefined,
      traceContext,
    );
  }

  /** Reconstrução a partir da persistência — não revalida transições. */
  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.eventVersion,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
      state.traceContext,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }

    if (this._nextAttemptAt === undefined) {
      return true;
    }

    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageAlreadyPublishedError(this.id);
    }

    this._publishedAt = at;
  }

  /** incrementa attempts e calcula o próximo nextAttemptAt (backoff) */
  scheduleRetry(now: Date, random: () => number = Math.random): void {
    if (!this.isPending()) {
      throw new OutboxMessageAlreadyPublishedError(this.id);
    }

    this._attempts += 1;
    // Sem limite de tentativas (ESCOLHAS #20): o teto do backoff segura o custo.
    const delayMs = retryDelaySeconds(this._attempts, random) * 1000;
    this._nextAttemptAt = new Date(now.getTime() + delayMs);
  }
}
