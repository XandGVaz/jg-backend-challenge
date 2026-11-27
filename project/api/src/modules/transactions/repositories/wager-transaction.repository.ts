import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { WagerTransactionKind } from '../domain/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../domain/wager-transaction-status.js';
import { translateTransactionConstraint } from './transaction-constraints.js';

const REVERSAL_KINDS = [WagerTransactionKind.Refund, WagerTransactionKind.Rollback];

export interface LookupOptions {
  /** `FOR UPDATE`: serializa decisões sobre a mesma linha até o commit. */
  forUpdate?: boolean;
}

/** Acesso a `wager_transactions`; nunca faz flush nem abre transação. */
@Injectable()
export class WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * INSERT imediato: a unicidade da key é decidida aqui, não no commit. O `em.insert` não deixa a
   * entidade gerenciada, então o `merge` a registra para as transições saírem no flush do caso de uso.
   */
  async insert(transaction: WagerTransaction): Promise<void> {
    try {
      await this.em.insert(transaction);
    } catch (error) {
      throw translateTransactionConstraint(error);
    }

    this.em.merge(transaction);
  }

  async findById(id: string, options: LookupOptions = {}): Promise<WagerTransaction | undefined> {
    const found = await this.em.findOne(WagerTransaction, { id }, lockOptions(options));
    return found ?? undefined;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | undefined> {
    const found = await this.em.findOne(WagerTransaction, { idempotencyKey });
    return found ?? undefined;
  }

  /** Pela chave do provedor (`uq_wager_transactions_external`); resolve também referências. */
  async findByExternalId(
    providerId: string,
    externalTransactionId: string,
    options: LookupOptions = {},
  ): Promise<WagerTransaction | undefined> {
    const found = await this.em.findOne(
      WagerTransaction,
      { providerId, externalTransactionId },
      lockOptions(options),
    );
    return found ?? undefined;
  }

  /** REFUND e ROLLBACK já aplicados sobre a referência (REQUISITOS §7 regra 4). */
  findProcessedReversals(referenceTransactionId: string): Promise<WagerTransaction[]> {
    return this.em.find(WagerTransaction, {
      _referenceTransactionId: referenceTransactionId,
      kind: { $in: REVERSAL_KINDS },
      _status: WagerTransactionStatus.Processed,
    } as never);
  }

  /** REFUND rejeitado que citava a BET: ela chega já cancelada (ESCOLHAS #21). */
  async existsRejectedRefundFor(
    providerId: string,
    referenceExternalTransactionId: string,
  ): Promise<boolean> {
    const count = await this.em.count(WagerTransaction, {
      providerId,
      referenceExternalTransactionId,
      kind: WagerTransactionKind.Refund,
      _status: WagerTransactionStatus.Rejected,
    } as never);
    return count > 0;
  }

  /**
   * Reserva as PENDING_REFERENCE vencidas com `FOR UPDATE SKIP LOCKED`: workers concorrentes
   * pegam linhas distintas, e a reserva dura até o commit (índice ix_wager_transactions_pending_reference).
   */
  claimDuePendingReferences(now: Date, limit: number): Promise<WagerTransaction[]> {
    return this.em.find(
      WagerTransaction,
      {
        _status: WagerTransactionStatus.PendingReference,
        _nextReferenceAttemptAt: { $lte: now },
      } as never,
      {
        orderBy: { _nextReferenceAttemptAt: 'asc', id: 'asc' } as never,
        limit,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
  }

  /** Gatilho imediato de ESCOLHAS #15: antecipa as PENDING_REFERENCE que citam a referência. */
  async expediteReferenceAttempts(
    providerId: string,
    referenceExternalTransactionId: string,
    at: Date,
  ): Promise<number> {
    const result = await this.em
      .createQueryBuilder(WagerTransaction)
      .update({ _nextReferenceAttemptAt: at, _updatedAt: at } as never)
      .where({
        providerId,
        referenceExternalTransactionId,
        _status: WagerTransactionStatus.PendingReference,
        _nextReferenceAttemptAt: { $gt: at },
      } as never)
      .execute('run');
    return result.affectedRows;
  }
}

function lockOptions(options: LookupOptions): { lockMode?: LockMode } {
  if (!options.forUpdate) {
    return {};
  }

  return { lockMode: LockMode.PESSIMISTIC_WRITE };
}
