import { computePayloadHash } from '../../../shared/contracts/payload-hash.js';
import type { FailureCode } from '../../../shared/domain/failure-code.js';
import { newId } from '../../../shared/domain/id.js';
import { Money } from '../../../shared/domain/money.js';
import { LedgerDirection } from './ledger-direction.js';
import {
  InvalidTransactionReferenceError,
  InvalidTransactionStateError,
  LedgerDirectionUnavailableError,
} from './wager-transaction.errors.js';
import { WagerTransactionKind } from './wager-transaction-kind.js';
import {
  canTransition,
  isTerminalStatus,
  WagerTransactionStatus,
} from './wager-transaction-status.js';

/** Provedor reservado das transações internas; o regex de `providerId` aceita, nenhum provedor real usa. */
export const INTERNAL_PROVIDER_ID = 'internal';

const REFERENCE_REQUIRED = new Set([WagerTransactionKind.Refund, WagerTransactionKind.Rollback]);
const REFERENCE_FORBIDDEN = new Set([
  WagerTransactionKind.Opening,
  WagerTransactionKind.Bet,
  WagerTransactionKind.Loss,
]);

type ByKind<T> = Readonly<Record<WagerTransactionKind, T>>;

// Kinds que cada operação pode referenciar (REQUISITOS §7 regra 3; WIN liga só a BET).
const ALLOWED_REFERENCE_KINDS: ByKind<readonly WagerTransactionKind[]> = {
  [WagerTransactionKind.Opening]: [],
  [WagerTransactionKind.Bet]: [],
  [WagerTransactionKind.Loss]: [],
  [WagerTransactionKind.Win]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Rollback]: [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ],
};

/** Sentido próprio de cada kind que move saldo sem depender da referência. */
const OWN_DIRECTION: Partial<ByKind<LedgerDirection>> = {
  [WagerTransactionKind.Opening]: LedgerDirection.Credit,
  [WagerTransactionKind.Bet]: LedgerDirection.Debit,
  [WagerTransactionKind.Win]: LedgerDirection.Credit,
  [WagerTransactionKind.Refund]: LedgerDirection.Credit,
};

/** Transação referenciada, como gravada no par `reference_transaction_id` + `reference_kind`. */
export interface WagerTransactionReference {
  readonly id: string;
  readonly kind: WagerTransactionKind;
}

export interface CreateWagerTransactionProps {
  id?: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface OpeningTransactionProps {
  id?: string;
  walletId: string;
  playerId: string;
  money: Money;
  createdAt: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  referenceKind?: WagerTransactionKind;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  resultBalanceAmount?: string;
  resultBalanceCurrency?: string;
  referenceAttempts: number;
  nextReferenceAttemptAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
}

/**
 * Operação financeira do provedor (ou interna, `OPENING`), com as transições de ESCOLHAS #13.
 * Valores monetários ficam como string decimal nos campos privados e saem sempre como `Money`.
 */
export class WagerTransaction {
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly gameId: string;
  public readonly kind: WagerTransactionKind;
  /** id no provedor, não o id interno. */
  public readonly referenceExternalTransactionId: string | undefined;
  public readonly createdAt: Date;
  private readonly _amount: string;
  private readonly _currency: string;
  private _status: WagerTransactionStatus;
  private _referenceTransactionId?: string;
  private _referenceKind?: WagerTransactionKind;
  private _failureCode?: FailureCode;
  private _resultBalanceAmount?: string;
  private _resultBalanceCurrency?: string;
  private _referenceAttempts: number;
  private _nextReferenceAttemptAt?: Date;
  private _updatedAt: Date;
  private _processedAt?: Date;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._amount = state.amount;
    this._currency = state.currency;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._referenceKind = state.referenceKind;
    this._failureCode = state.failureCode;
    this._resultBalanceAmount = state.resultBalanceAmount;
    this._resultBalanceCurrency = state.resultBalanceCurrency;
    this._referenceAttempts = state.referenceAttempts;
    this._nextReferenceAttemptAt = state.nextReferenceAttemptAt;
    this._updatedAt = state.updatedAt;
    this._processedAt = state.processedAt;
  }

  /** Nasce em PENDING. Valida a exigência de referência por kind. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const hasReference = props.referenceExternalTransactionId !== undefined;

    if (REFERENCE_REQUIRED.has(props.kind) && !hasReference) {
      throw new InvalidTransactionReferenceError(props.kind, true);
    }

    if (REFERENCE_FORBIDDEN.has(props.kind) && hasReference) {
      throw new InvalidTransactionReferenceError(props.kind, false);
    }

    const money = props.money.toJSON();

    return new WagerTransaction({
      id: props.id ?? newId(),
      providerId: props.providerId,
      externalTransactionId: props.externalTransactionId,
      idempotencyKey: props.idempotencyKey,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: props.roundId,
      gameId: props.gameId,
      kind: props.kind,
      amount: money.amount,
      currency: money.currency,
      referenceExternalTransactionId: props.referenceExternalTransactionId,
      status: WagerTransactionStatus.Pending,
      referenceAttempts: 0,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  /** Crédito de abertura da wallet: identidade interna derivada do `walletId`, em PENDING. */
  static opening(props: OpeningTransactionProps): WagerTransaction {
    const externalTransactionId = `opening-${props.walletId}`;
    const payload = {
      walletId: props.walletId,
      playerId: props.playerId,
      kind: WagerTransactionKind.Opening,
      money: props.money.toJSON(),
    };

    return WagerTransaction.create({
      id: props.id,
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId,
      idempotencyKey: `${INTERNAL_PROVIDER_ID}:${externalTransactionId}`,
      payloadHash: computePayloadHash(payload),
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: externalTransactionId,
      gameId: 'wallet-opening',
      kind: WagerTransactionKind.Opening,
      money: props.money,
      createdAt: props.createdAt,
    });
  }

  /** Reconstrução a partir da persistência — não revalida transições. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction({ ...state });
  }

  get money(): Money {
    return Money.from({ amount: this._amount, currency: this._currency });
  }

  // Formas persistidas (string decimal e código da moeda), lidas pelo mapeamento do MikroORM.
  get amount(): string {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  get resultBalanceAmount(): string | undefined {
    return this._resultBalanceAmount;
  }

  get resultBalanceCurrency(): string | undefined {
    return this._resultBalanceCurrency;
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get referenceKind(): WagerTransactionKind | undefined {
    return this._referenceKind;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  /** Saldo observado ao concluir; o replay devolve este valor (REQUISITOS §7 regra 7). */
  get resultBalance(): Money | undefined {
    if (this._resultBalanceAmount === undefined || this._resultBalanceCurrency === undefined) {
      return undefined;
    }

    return Money.from({
      amount: this._resultBalanceAmount,
      currency: this._resultBalanceCurrency,
    });
  }

  // ---- transições (lançam InvalidTransactionStateError fora da tabela de ESCOLHAS #13)

  /** Aplica a transação; `reference` é a transação ligada (REFUND, ROLLBACK e WIN com BET encontrada). */
  markProcessed(reference: WagerTransactionReference | undefined, at: Date): void {
    this.assertTransition(WagerTransactionStatus.Processed, 'markProcessed');
    this.assertLinkableReference(reference);
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = reference?.id;
    this._referenceKind = reference?.kind;
    this._processedAt = at;
    this._nextReferenceAttemptAt = undefined;
    this._updatedAt = at;
  }

  /** Referência ausente; a primeira tentativa de reprocessamento fica para `nextAttemptAt`. */
  markPendingReference(nextAttemptAt: Date = this.createdAt): void {
    this.assertTransition(WagerTransactionStatus.PendingReference, 'markPendingReference');
    this._status = WagerTransactionStatus.PendingReference;
    this._nextReferenceAttemptAt = nextAttemptAt;
  }

  reject(code: FailureCode): void {
    this.assertTransition(WagerTransactionStatus.Rejected, 'reject');
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._nextReferenceAttemptAt = undefined;
  }

  fail(code: FailureCode): void {
    this.assertTransition(WagerTransactionStatus.Failed, 'fail');
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._nextReferenceAttemptAt = undefined;
  }

  /** Conta uma tentativa de resolver a referência e agenda a próxima; o estado continua PENDING_REFERENCE. */
  scheduleReferenceRetry(nextAttemptAt: Date): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError(this.id, this._status, 'scheduleReferenceRetry');
    }

    this._referenceAttempts += 1;
    this._nextReferenceAttemptAt = nextAttemptAt;
  }

  /** Registra o saldo observado antes do estado final, para o replay e para o evento. */
  observeBalance(balance: Money): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this.id, this._status, 'observeBalance');
    }

    const observed = balance.toJSON();
    this._resultBalanceAmount = observed.amount;
    this._resultBalanceCurrency = observed.currency;
  }

  // ---- consultas de domínio

  isTerminal(): boolean {
    return isTerminalStatus(this._status);
  }

  /** false para LOSS e para valor zero: sem alteração de saldo não há lançamento (ESCOLHAS #21). */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss && this.money.isPositive();
  }

  /** true para REFUND e ROLLBACK. */
  requiresReference(): boolean {
    return REFERENCE_REQUIRED.has(this.kind);
  }

  /** Se esta transação pode ser ligada a uma referência do kind informado (REQUISITOS §7 regra 3). */
  acceptsReferenceKind(kind: WagerTransactionKind): boolean {
    return ALLOWED_REFERENCE_KINDS[this.kind].includes(kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /** DEBIT ou CREDIT do lançamento; o ROLLBACK inverte o sentido da referência. */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === WagerTransactionKind.Loss) {
      throw new LedgerDirectionUnavailableError(this.kind, reference?.kind);
    }

    if (!this.requiresReference()) {
      return this.ownDirection(reference?.kind);
    }

    if (reference === undefined || !this.acceptsReferenceKind(reference.kind)) {
      throw new LedgerDirectionUnavailableError(this.kind, reference?.kind);
    }

    if (this.kind === WagerTransactionKind.Refund) {
      return LedgerDirection.Credit;
    }

    return invert(reference.ownDirection(undefined));
  }

  private ownDirection(referenceKind: WagerTransactionKind | undefined): LedgerDirection {
    const direction = OWN_DIRECTION[this.kind];

    if (direction === undefined) {
      throw new LedgerDirectionUnavailableError(this.kind, referenceKind);
    }

    return direction;
  }

  private assertTransition(to: WagerTransactionStatus, operation: string): void {
    if (!canTransition(this._status, to)) {
      throw new InvalidTransactionStateError(this.id, this._status, operation);
    }
  }

  // O CHECK de referência e a FK composta exigem o par coerente com o kind.
  private assertLinkableReference(reference: WagerTransactionReference | undefined): void {
    if (reference === undefined && this.requiresReference()) {
      throw new InvalidTransactionStateError(this.id, this._status, 'markProcessed unlinked');
    }

    if (reference === undefined) {
      return;
    }

    if (reference.id === this.id || !this.acceptsReferenceKind(reference.kind)) {
      throw new InvalidTransactionStateError(
        this.id,
        this._status,
        `markProcessed with reference of kind ${reference.kind}`,
      );
    }
  }
}

function invert(direction: LedgerDirection): LedgerDirection {
  return direction === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
}
