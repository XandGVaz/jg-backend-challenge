import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { loadEnv } from '../../../config/env.js';
import { runTransaction, type RunTransactionOptions } from '../../../database/run-transaction.js';
import { currentCorrelationId } from '../../../observability/correlation.js';
import { computePayloadHash } from '../../../shared/contracts/payload-hash.js';
import { FailureCode } from '../../../shared/domain/failure-code.js';
import { Money } from '../../../shared/domain/money.js';
import { AppError, ErrorKind, TransactionRejectedError } from '../../../shared/errors/index.js';
import { retryDelaySeconds } from '../../../shared/messaging/retry-backoff.js';
import { ProviderIdentityPort } from '../../auth/domain/provider-identity.port.js';
import { InboxService } from '../../inbox/services/inbox.service.js';
import { OutboxService } from '../../outbox/services/outbox.service.js';
import { RoundClosedError } from '../../rounds/domain/round-closed.error.js';
import { RoundsService } from '../../rounds/services/rounds.service.js';
import { WagerTransactionPendingReference } from '../../transactions/domain/events/wager-transaction-pending-reference.event.js';
import { WagerTransactionProcessed } from '../../transactions/domain/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../transactions/domain/events/wager-transaction-rejected.event.js';
import { LedgerDirection } from '../../transactions/domain/ledger-direction.js';
import { DuplicateTransactionError } from '../../transactions/domain/wager-transaction.errors.js';
import { WagerTransactionKind } from '../../transactions/domain/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../transactions/domain/wager-transaction-status.js';
import type { WagerTransaction } from '../../transactions/domain/wager-transaction.js';
import { TransactionsService } from '../../transactions/services/transactions.service.js';
import type { Wallet } from '../../wallets/domain/wallet.js';
import { InsufficientBalanceError } from '../../wallets/domain/wallet.errors.js';
import { WalletsService } from '../../wallets/services/wallets.service.js';
import type { SubmitTransactionRequest } from '../wagering.schema.js';
import {
  recordDuplicate,
  recordProcessingDuration,
  recordTransaction,
  type Channel,
} from '../wagering.metrics.js';

const tracer = trace.getTracer('wagering-api.wagering');
const REVERSALS = new Set([WagerTransactionKind.Refund, WagerTransactionKind.Rollback]);
const REFERENCEABLE = new Set([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Refund,
]);

/** Entrada SQS: a inbox deduplica por `(consumerName, messageId)` dentro da mesma transação. */
export interface InboxRef {
  consumerName: string;
  messageId: string;
}

export interface SubmitResult {
  transaction: WagerTransaction;
  balance: Money;
  idempotentReplay: boolean;
}

/** Transação que a infraestrutura não conseguiu processar (FAILED): reenviar mais tarde (api.md §10). */
export class TransactionFailedError extends AppError {
  readonly kind = ErrorKind.Transient;
  readonly code = FailureCode.ProcessingRetriesExhausted;

  constructor(readonly transactionId: string) {
    super(`Wager transaction ${transactionId} failed after exhausting its retries`);
  }
}

/** Resultado interno de uma transação: o que responder e se ela foi rejeitada. */
interface Outcome {
  transaction: WagerTransaction;
  balance: Money;
  replay: boolean;
}

/**
 * Caso de uso de submissão (REQUISITOS §7–§9): idempotência, referências, rodadas, saldo, ledger e
 * eventos na mesma transação SQL. Rejeição é resultado gravado: o 422 sai só depois do commit.
 */
@Injectable()
export class SubmitTransactionService {
  private readonly logger = new Logger(SubmitTransactionService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly em: EntityManager,
    private readonly transactions: TransactionsService,
    private readonly wallets: WalletsService,
    private readonly rounds: RoundsService,
    private readonly outbox: OutboxService,
    private readonly inbox: InboxService,
    private readonly identity: ProviderIdentityPort,
  ) {}

  submit(
    input: SubmitTransactionRequest,
    idempotencyKey: string,
    channel: Channel,
    inbox?: InboxRef,
  ): Promise<SubmitResult> {
    this.identity.assertCanActAs(input.providerId, channel === 'sqs' ? 'sqs' : 'http');
    const payloadHash = computePayloadHash(input);
    const startedAt = performance.now();

    return tracer.startActiveSpan('wager.submit', async (span) => {
      span.setAttributes({
        'wagering.channel': channel,
        'wagering.provider_id': input.providerId,
        'wagering.wallet_id': input.walletId,
        'wagering.transaction.external_id': input.externalTransactionId,
        'wagering.transaction.kind': input.kind,
      });

      try {
        const outcome = await this.submitWithReplayOnRace(
          input,
          idempotencyKey,
          payloadHash,
          channel,
          inbox,
        );
        this.observe(span, outcome, channel, startedAt);
        return this.respond(outcome);
      } catch (error) {
        markSpanFailure(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /** Retomada pelo agendador: tenta de novo a referência de uma PENDING_REFERENCE (REQUISITOS §7.1). */
  resume(transactionId: string): Promise<WagerTransactionStatus | undefined> {
    return runTransaction(this.em, this.options('reprocess_pending'), async () => {
      const transaction = await this.transactions.findById(transactionId, { forUpdate: true });

      if (transaction?.status !== WagerTransactionStatus.PendingReference) {
        this.logger.debug({ message: 'Pending reference already resolved', transactionId });
        return transaction?.status;
      }

      const wallet = await this.wallets.get(transaction.walletId);
      const outcome = await this.process(transaction, wallet, new Date(), true);
      recordTransaction(
        'scheduler',
        transaction.kind,
        outcome.transaction.status,
        outcome.transaction.failureCode,
      );
      return outcome.transaction.status;
    });
  }

  /** Entrega SQS esgotada por falha transitória: grava FAILED (PROCESSING_RETRIES_EXHAUSTED) para auditoria. */
  failExhausted(input: SubmitTransactionRequest, idempotencyKey: string): Promise<void> {
    const payloadHash = computePayloadHash(input);

    return runTransaction(this.em, this.options('submit_transaction'), async () => {
      const existing = await this.transactions.findByIdempotencyKey(idempotencyKey);

      if (existing) {
        this.logger.debug({
          message: 'Exhausted message already has a transaction',
          transactionId: existing.id,
        });
        return;
      }

      const wallet = await this.wallets.get(input.walletId);
      const transaction = await this.register(input, idempotencyKey, payloadHash, new Date());
      transaction.observeBalance(wallet.balance);
      transaction.fail(FailureCode.ProcessingRetriesExhausted);
      this.logger.error({
        message: 'Transaction failed after exhausting retries',
        transactionId: transaction.id,
      });
      recordTransaction('sqs', transaction.kind, transaction.status, transaction.failureCode);
    });
  }

  // Duas requisições com a mesma key: a segunda espera no índice único e perde; refaz como replay.
  private async submitWithReplayOnRace(
    input: SubmitTransactionRequest,
    idempotencyKey: string,
    payloadHash: string,
    channel: Channel,
    inbox: InboxRef | undefined,
  ): Promise<Outcome> {
    try {
      return await this.runSubmit(input, idempotencyKey, payloadHash, channel, inbox);
    } catch (error) {
      if (!(error instanceof DuplicateTransactionError)) {
        throw error;
      }

      this.logger.debug({ message: 'Concurrent submit lost the idempotency race', channel });
      return this.runSubmit(input, idempotencyKey, payloadHash, channel, inbox);
    }
  }

  private runSubmit(
    input: SubmitTransactionRequest,
    idempotencyKey: string,
    payloadHash: string,
    channel: Channel,
    inbox: InboxRef | undefined,
  ): Promise<Outcome> {
    return runTransaction(this.em, this.options('submit_transaction'), async () => {
      if (inbox) {
        await this.inbox.receive(inbox.consumerName, inbox.messageId, payloadHash);
      }

      const existing = await this.transactions.findByIdempotencyKey(idempotencyKey);

      if (existing) {
        await this.markInbox(inbox);
        return this.replay(existing, payloadHash, channel);
      }

      const wallet = await this.wallets.get(input.walletId);
      const at = new Date();
      const transaction = await this.register(input, idempotencyKey, payloadHash, at);
      const outcome = await this.process(transaction, wallet, at, false);
      await this.markInbox(inbox);
      return outcome;
    });
  }

  private register(
    input: SubmitTransactionRequest,
    idempotencyKey: string,
    payloadHash: string,
    at: Date,
  ): Promise<WagerTransaction> {
    return this.transactions.register({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind as WagerTransactionKind,
      money: Money.from(input.money),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
      createdAt: at,
    });
  }

  /** Mesma key: mesmo payload devolve o resultado original; payload diferente é conflito (§9). */
  private async replay(
    existing: WagerTransaction,
    payloadHash: string,
    channel: Channel,
  ): Promise<Outcome> {
    if (!existing.matchesPayload(payloadHash)) {
      recordDuplicate(channel, 'conflict');
      this.logger.warn({
        message: 'Idempotency key reused with another payload',
        transactionId: existing.id,
      });
      throw new DuplicateTransactionError('idempotency_key');
    }

    recordDuplicate(channel, 'replay');
    this.logger.debug({ message: 'Idempotent replay', transactionId: existing.id });
    const balance = existing.resultBalance ?? (await this.wallets.get(existing.walletId)).balance;
    return { transaction: existing, balance, replay: true };
  }

  /** Aplica as regras e leva a transação a PROCESSED, REJECTED ou PENDING_REFERENCE. */
  private async process(
    transaction: WagerTransaction,
    wallet: Wallet,
    at: Date,
    resuming: boolean,
  ): Promise<Outcome> {
    const preconditionFailure = await this.checkPreconditions(transaction, wallet, at);

    if (preconditionFailure) {
      return this.reject(transaction, wallet, preconditionFailure);
    }

    const resolution = await this.resolveReference(transaction);

    if (resolution.kind === 'missing') {
      return this.pendOrExpire(transaction, wallet, at, resuming);
    }

    if (resolution.kind === 'rejected') {
      return this.reject(transaction, wallet, resolution.code);
    }

    const reference = resolution.reference;

    if (
      transaction.kind === WagerTransactionKind.Win ||
      transaction.kind === WagerTransactionKind.Loss
    ) {
      await this.rounds.registerResult(transaction.providerId, transaction.roundId, at);
    }

    if (!transaction.affectsBalance()) {
      return this.complete(transaction, wallet.balance, reference, at);
    }

    const expectedVersion = wallet.version;
    const direction = transaction.ledgerDirectionFor(reference);

    try {
      const entry =
        direction === LedgerDirection.Debit
          ? wallet.debit(transaction.money, transaction.id, at)
          : wallet.credit(transaction.money, transaction.id, at);
      await this.wallets.commit(wallet, expectedVersion, entry);
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        const code = REVERSALS.has(transaction.kind)
          ? FailureCode.ReversalInsufficientFunds
          : FailureCode.InsufficientFunds;
        return this.reject(transaction, wallet, code);
      }

      throw error;
    }

    return this.complete(transaction, wallet.balance, reference, at);
  }

  /** Regras que independem da referência: wallet do jogador, moeda, BET cancelada e rodada fechada. */
  private async checkPreconditions(
    transaction: WagerTransaction,
    wallet: Wallet,
    at: Date,
  ): Promise<FailureCode | undefined> {
    if (wallet.playerId !== transaction.playerId) {
      return FailureCode.WalletPlayerMismatch;
    }

    if (wallet.currency !== transaction.money.currency) {
      return FailureCode.CurrencyMismatch;
    }

    if (transaction.kind !== WagerTransactionKind.Bet) {
      return undefined;
    }

    if (await this.transactions.isCancelledBet(transaction)) {
      return FailureCode.BetAlreadyCancelled;
    }

    try {
      await this.rounds.assertBetAllowed(transaction.providerId, transaction.roundId, at);
    } catch (error) {
      if (error instanceof RoundClosedError) {
        return FailureCode.RoundClosed;
      }

      throw error;
    }

    return undefined;
  }

  private async resolveReference(
    transaction: WagerTransaction,
  ): Promise<
    | { kind: 'none' | 'found'; reference?: WagerTransaction }
    | { kind: 'missing' }
    | { kind: 'rejected'; code: FailureCode }
  > {
    if (transaction.referenceExternalTransactionId === undefined) {
      return { kind: 'none' };
    }

    const reference = await this.transactions.findReferenceForUpdate(transaction);

    // WIN com referência ausente é processado sem ligação (ESCOLHAS #21).
    if (!reference) {
      return transaction.requiresReference() ? { kind: 'missing' } : { kind: 'none' };
    }

    if (
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.money.currency !== transaction.money.currency ||
      reference.roundId !== transaction.roundId
    ) {
      return { kind: 'rejected', code: FailureCode.ReferenceMismatch };
    }

    if (!transaction.acceptsReferenceKind(reference.kind)) {
      return { kind: 'rejected', code: FailureCode.ReferenceKindNotAllowed };
    }

    if (reference.status === WagerTransactionStatus.PendingReference) {
      return { kind: 'missing' };
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return { kind: 'rejected', code: FailureCode.ReferenceNotProcessed };
    }

    if (!transaction.requiresReference()) {
      return { kind: 'found', reference };
    }

    if (!reference.money.equals(transaction.money)) {
      return { kind: 'rejected', code: FailureCode.ReversalAmountMismatch };
    }

    const reversals = await this.transactions.findProcessedReversals(reference);
    // Uma BET aceita um único estorno, de qualquer tipo; as demais, um por tipo (ESCOLHAS #21).
    const alreadyReversed =
      reference.kind === WagerTransactionKind.Bet
        ? reversals.length > 0
        : reversals.some((reversal) => reversal.kind === transaction.kind);

    if (alreadyReversed) {
      return { kind: 'rejected', code: FailureCode.ReferenceAlreadyReversed };
    }

    return { kind: 'found', reference };
  }

  /** Referência ainda ausente: agenda nova tentativa, ou rejeita quando o limite acabou (ESCOLHAS #15). */
  private async pendOrExpire(
    transaction: WagerTransaction,
    wallet: Wallet,
    at: Date,
    resuming: boolean,
  ): Promise<Outcome> {
    const attempt = transaction.referenceAttempts + 1;

    if (resuming && attempt >= this.env.PENDING_REFERENCE_MAX_ATTEMPTS) {
      return this.reject(transaction, wallet, FailureCode.ReferenceNotFound);
    }

    const delay = retryDelaySeconds(attempt, Math.random, {
      baseSeconds: this.env.PENDING_REFERENCE_BACKOFF_BASE_SECONDS,
      maxSeconds: this.env.PENDING_REFERENCE_BACKOFF_MAX_SECONDS,
    });
    const nextAttemptAt = new Date(at.getTime() + delay * 1000);

    if (resuming) {
      transaction.scheduleReferenceRetry(nextAttemptAt);
      this.logger.debug({
        message: 'Reference still missing',
        transactionId: transaction.id,
        attempt,
      });
      return { transaction, balance: wallet.balance, replay: false };
    }

    transaction.observeBalance(wallet.balance);
    transaction.markPendingReference(nextAttemptAt);
    this.outbox.enqueue(
      WagerTransactionPendingReference.from(transaction, this.eventContext(transaction)),
    );
    this.logger.log({
      message: 'Transaction waiting for its reference',
      transactionId: transaction.id,
    });
    return { transaction, balance: wallet.balance, replay: false };
  }

  private complete(
    transaction: WagerTransaction,
    balance: Money,
    reference: WagerTransaction | undefined,
    at: Date,
  ): Promise<Outcome> {
    transaction.observeBalance(balance);
    transaction.markProcessed(
      reference ? { id: reference.id, kind: reference.kind } : undefined,
      at,
    );
    this.outbox.enqueue(
      WagerTransactionProcessed.from(transaction, balance, this.eventContext(transaction)),
    );
    return this.advanceWaiting(transaction, at).then(() => ({
      transaction,
      balance,
      replay: false,
    }));
  }

  // Gatilho imediato: quem esperava por esta transação é reprocessado no próximo ciclo (ESCOLHAS #15).
  private async advanceWaiting(transaction: WagerTransaction, at: Date): Promise<void> {
    if (!REFERENCEABLE.has(transaction.kind)) {
      return;
    }

    const advanced = await this.transactions.expediteWaitingFor(transaction, at);

    if (advanced > 0) {
      this.logger.debug({
        message: 'Pending references advanced',
        transactionId: transaction.id,
        advanced,
      });
    }
  }

  private reject(transaction: WagerTransaction, wallet: Wallet, code: FailureCode): Outcome {
    transaction.observeBalance(wallet.balance);
    transaction.reject(code);
    this.outbox.enqueue(WagerTransactionRejected.from(transaction, this.eventContext(transaction)));
    this.logger.warn({
      message: 'Transaction rejected',
      transactionId: transaction.id,
      failureCode: code,
    });
    return { transaction, balance: wallet.balance, replay: false };
  }

  private async markInbox(inbox: InboxRef | undefined): Promise<void> {
    if (inbox) {
      await this.inbox.markProcessed(inbox.consumerName, inbox.messageId, new Date());
    }
  }

  /** Depois do commit: rejeição vira 422 com o transactionId; FAILED vira 503 (reenviar mais tarde). */
  private respond(outcome: Outcome): SubmitResult {
    const { transaction } = outcome;

    if (transaction.status === WagerTransactionStatus.Rejected) {
      throw new TransactionRejectedError(transaction.failureCode ?? 'REJECTED', transaction.id);
    }

    if (transaction.status === WagerTransactionStatus.Failed) {
      throw new TransactionFailedError(transaction.id);
    }

    return { transaction, balance: outcome.balance, idempotentReplay: outcome.replay };
  }

  private observe(span: Span, outcome: Outcome, channel: Channel, startedAt: number): void {
    const { transaction } = outcome;
    span.setAttributes({
      'wagering.transaction.id': transaction.id,
      'wagering.transaction.status': transaction.status,
      'wagering.idempotent_replay': outcome.replay,
      ...(transaction.failureCode && { 'wagering.failure_code': transaction.failureCode }),
    });

    if (outcome.replay) {
      span.addEvent('idempotency.replay');
      return;
    }

    recordTransaction(channel, transaction.kind, transaction.status, transaction.failureCode);
    recordProcessingDuration(
      channel,
      transaction.kind,
      transaction.status,
      (performance.now() - startedAt) / 1000,
    );
  }

  private eventContext(transaction: WagerTransaction): {
    correlationId: string;
    causationId: string;
  } {
    return { correlationId: currentCorrelationId() ?? transaction.id, causationId: transaction.id };
  }

  private options(useCase: RunTransactionOptions['useCase']): RunTransactionOptions {
    return { useCase, maxAttempts: this.env.OPTIMISTIC_LOCK_MAX_ATTEMPTS };
  }
}

// Rejeição de negócio e 4xx ficam UNSET; só transitório ou inesperado é ERROR (jaeger.md §5).
function markSpanFailure(span: Span, error: unknown): void {
  if (
    error instanceof AppError &&
    error.kind !== ErrorKind.Transient &&
    error.kind !== ErrorKind.Internal
  ) {
    if (error instanceof DuplicateTransactionError) {
      span.addEvent('idempotency.conflict');
    }
    return;
  }

  const failure = error instanceof Error ? error : new Error(String(error));
  span.recordException(failure);
  span.setStatus({ code: SpanStatusCode.ERROR, message: failure.name });
}
