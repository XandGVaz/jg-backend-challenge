import { Injectable } from '@nestjs/common';
import {
  WagerTransaction,
  type CreateWagerTransactionProps,
  type OpeningTransactionProps,
} from '../domain/wager-transaction.js';
import { TransactionNotFoundError } from '../domain/wager-transaction.errors.js';
import {
  WagerTransactionRepository,
  type LookupOptions,
} from '../repositories/wager-transaction.repository.js';

/**
 * Persistência e consulta de `WagerTransaction` para os casos de uso de wallets e wagering.
 * Roda na transação aberta pelo chamador (`runTransaction`); as transições do domínio saem no flush dele.
 */
@Injectable()
export class TransactionsService {
  constructor(private readonly transactions: WagerTransactionRepository) {}

  /** Cria em PENDING e insere já: a key fica reservada na transação do chamador (ESCOLHAS #13). */
  async register(props: CreateWagerTransactionProps): Promise<WagerTransaction> {
    const transaction = WagerTransaction.create(props);
    await this.transactions.insert(transaction);
    return transaction;
  }

  /** OPENING PROCESSED com o saldo inicial como saldo observado; valor zero não gera lançamento. */
  async recordOpening(props: OpeningTransactionProps): Promise<WagerTransaction> {
    const transaction = WagerTransaction.opening(props);
    transaction.observeBalance(props.money);
    transaction.markProcessed(undefined, props.createdAt);
    await this.transactions.insert(transaction);
    return transaction;
  }

  findById(id: string, options?: LookupOptions): Promise<WagerTransaction | undefined> {
    return this.transactions.findById(id, options);
  }

  async getById(id: string): Promise<WagerTransaction> {
    const transaction = await this.transactions.findById(id);

    if (transaction === undefined) {
      throw new TransactionNotFoundError('transactionId');
    }

    return transaction;
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | undefined> {
    return this.transactions.findByIdempotencyKey(idempotencyKey);
  }

  findByExternalId(
    providerId: string,
    externalTransactionId: string,
    options?: LookupOptions,
  ): Promise<WagerTransaction | undefined> {
    return this.transactions.findByExternalId(providerId, externalTransactionId, options);
  }

  async getByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction> {
    const transaction = await this.transactions.findByExternalId(providerId, externalTransactionId);

    if (transaction === undefined) {
      throw new TransactionNotFoundError('externalTransactionId');
    }

    return transaction;
  }

  /** Referência por `(providerId, referenceExternalTransactionId)` com `FOR UPDATE` (REQUISITOS §7 regra 2). */
  findReferenceForUpdate(transaction: WagerTransaction): Promise<WagerTransaction | undefined> {
    const reference = transaction.referenceExternalTransactionId;

    if (reference === undefined) {
      return Promise.resolve(undefined);
    }

    return this.transactions.findByExternalId(transaction.providerId, reference, {
      forUpdate: true,
    });
  }

  findProcessedReversals(reference: WagerTransaction): Promise<WagerTransaction[]> {
    return this.transactions.findProcessedReversals(reference.id);
  }

  /** BET citada por um REFUND rejeitado chega cancelada (`BET_ALREADY_CANCELLED`, ESCOLHAS #21). */
  isCancelledBet(bet: WagerTransaction): Promise<boolean> {
    return this.transactions.existsRejectedRefundFor(bet.providerId, bet.externalTransactionId);
  }

  claimDuePendingReferences(now: Date, limit: number): Promise<WagerTransaction[]> {
    return this.transactions.claimDuePendingReferences(now, limit);
  }

  /** Ao processar uma transação referenciável, antecipa quem esperava por ela (ESCOLHAS #15). */
  expediteWaitingFor(reference: WagerTransaction, at: Date): Promise<number> {
    return this.transactions.expediteReferenceAttempts(
      reference.providerId,
      reference.externalTransactionId,
      at,
    );
  }
}
