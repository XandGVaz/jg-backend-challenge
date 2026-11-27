import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode, QueryOrder } from '@mikro-orm/postgresql';
import { OutboxMessage } from '../domain/outbox-message.js';

export interface OutboxBacklog {
  pending: number;
  oldestOccurredAt?: Date;
}

interface BacklogRow {
  pending: number | string;
  oldest: Date | string | null;
}

const BACKLOG_SQL =
  'SELECT count(*)::int AS pending, min(occurred_at) AS oldest FROM outbox_messages WHERE published_at IS NULL';

@Injectable()
export class OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  /** Só agenda o INSERT; o flush é o commit da transação do chamador. */
  add(message: OutboxMessage): void {
    this.em.persist(message);
  }

  /**
   * Reserva as pendentes vencidas com FOR UPDATE SKIP LOCKED: publishers concorrentes pegam
   * lotes disjuntos e, se o processo cair, o rollback libera as linhas (ESCOLHAS #20).
   */
  claimDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    return this.em.find(
      OutboxMessage,
      {
        _publishedAt: null,
        $or: [{ _nextAttemptAt: null }, { _nextAttemptAt: { $lte: now } }],
      } as never,
      {
        orderBy: [{ _nextAttemptAt: QueryOrder.ASC }, { occurredAt: QueryOrder.ASC }] as never,
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
  }

  /** Leitura fora da unidade de trabalho, para os gauges de backlog (docs/prometheus.md §7). */
  async backlog(): Promise<OutboxBacklog> {
    const [row] = await this.em.getConnection().execute<BacklogRow[]>(BACKLOG_SQL);

    if (!row?.oldest) {
      return { pending: Number(row?.pending ?? 0) };
    }

    return { pending: Number(row.pending), oldestOccurredAt: new Date(row.oldest) };
  }
}
