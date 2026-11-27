import { describe, expect, it } from 'bun:test';
import { FailureCode } from '../../../shared/domain/failure-code.js';
import { Money } from '../../../shared/domain/money.js';
import { LedgerDirection } from './ledger-direction.js';
import {
  INTERNAL_PROVIDER_ID,
  WagerTransaction,
  type CreateWagerTransactionProps,
} from './wager-transaction.js';
import {
  InvalidTransactionReferenceError,
  InvalidTransactionStateError,
  LedgerDirectionUnavailableError,
} from './wager-transaction.errors.js';
import { WagerTransactionKind as Kind } from './wager-transaction-kind.js';
import {
  canTransition,
  isTerminalStatus,
  WAGER_TRANSACTION_TRANSITIONS,
  WagerTransactionStatus as Status,
} from './wager-transaction-status.js';

const CREATED_AT = new Date('2026-11-26T15:00:00.000Z');
const PROCESSED_AT = new Date('2026-11-26T15:00:01.000Z');
const REFERENCED = new Set([Kind.Refund, Kind.Rollback, Kind.Win]);

function brl(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function create(
  kind: Kind,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({
    providerId: 'provider-a',
    externalTransactionId: `tx-${kind.toLowerCase()}`,
    idempotencyKey: `provider-a:tx-${kind.toLowerCase()}`,
    payloadHash: `v1:${'a'.repeat(64)}`,
    walletId: '0192f2a0-0000-7000-8000-000000000001',
    playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: brl('10.00'),
    referenceExternalTransactionId: REFERENCED.has(kind) ? 'tx-ref' : undefined,
    createdAt: CREATED_AT,
    ...overrides,
  });
}

/** Leva uma transação nova até o estado pedido pelos caminhos válidos. */
function inStatus(status: Status, kind = Kind.Bet): WagerTransaction {
  const transaction = create(kind);
  const actions: Record<Status, () => void> = {
    [Status.Pending]: () => undefined,
    [Status.PendingReference]: () => transaction.markPendingReference(),
    [Status.Processed]: () => transaction.markProcessed(undefined, PROCESSED_AT),
    [Status.Rejected]: () => transaction.reject(FailureCode.InsufficientFunds),
    [Status.Failed]: () => transaction.fail(FailureCode.ProcessingRetriesExhausted),
  };
  actions[status]();
  return transaction;
}

function transitionTo(transaction: WagerTransaction, to: Status): void {
  const actions: Record<Status, () => void> = {
    [Status.Pending]: () => {
      throw new InvalidTransactionStateError(transaction.id, transaction.status, 'pending');
    },
    [Status.PendingReference]: () => transaction.markPendingReference(PROCESSED_AT),
    [Status.Processed]: () => transaction.markProcessed(undefined, PROCESSED_AT),
    [Status.Rejected]: () => transaction.reject(FailureCode.ReferenceNotFound),
    [Status.Failed]: () => transaction.fail(FailureCode.ProcessingRetriesExhausted),
  };
  actions[to]();
}

const ALL_STATUSES = Object.values(Status);
const ALL_KINDS = Object.values(Kind);

describe('WagerTransaction transitions (ESCOLHAS #13)', () => {
  it('documents exactly the table of ESCOLHAS #13', () => {
    expect(WAGER_TRANSACTION_TRANSITIONS).toEqual({
      PENDING: ['PROCESSED', 'REJECTED', 'FAILED', 'PENDING_REFERENCE'],
      PENDING_REFERENCE: ['PROCESSED', 'REJECTED', 'FAILED'],
      PROCESSED: [],
      REJECTED: [],
      FAILED: [],
    } as never);
  });

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const valid = canTransition(from, to);

      it(`${valid ? 'allows' : 'refuses'} ${from} -> ${to}`, () => {
        const transaction = inStatus(from);

        if (!valid) {
          expect(() => transitionTo(transaction, to)).toThrow(InvalidTransactionStateError);
          expect(transaction.status).toBe(from);
          return;
        }

        transitionTo(transaction, to);
        expect(transaction.status).toBe(to);
      });
    }
  }

  it('marks PROCESSED, REJECTED and FAILED as terminal and the others as open', () => {
    for (const status of ALL_STATUSES) {
      const terminal = [Status.Processed, Status.Rejected, Status.Failed].includes(status);

      expect(isTerminalStatus(status)).toBe(terminal);
      expect(inStatus(status).isTerminal()).toBe(terminal);
    }
  });

  it('keeps terminal state and fields when a transition is refused', () => {
    const transaction = inStatus(Status.Rejected);

    expect(() => transaction.markProcessed(undefined, PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.fail(FailureCode.ProcessingRetriesExhausted)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.observeBalance(brl('1.00'))).toThrow(InvalidTransactionStateError);
    expect(transaction.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(transaction.processedAt).toBeUndefined();
  });

  it('records reference, kind and time when processed', () => {
    const bet = inStatus(Status.Processed);
    const refund = create(Kind.Refund);

    refund.markProcessed(bet, PROCESSED_AT);

    expect(refund.status).toBe(Status.Processed);
    expect(refund.referenceTransactionId).toBe(bet.id);
    expect(refund.referenceKind).toBe(Kind.Bet);
    expect(refund.processedAt).toBe(PROCESSED_AT);
    expect(refund.failureCode).toBeUndefined();
  });

  it('refuses to process a reversal without a linked reference or with a forbidden kind', () => {
    const rollback = create(Kind.Rollback);
    const loss = create(Kind.Loss);

    expect(() => rollback.markProcessed(undefined, PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => rollback.markProcessed(loss, PROCESSED_AT)).toThrow(InvalidTransactionStateError);
    expect(() => rollback.markProcessed(rollback, PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => create(Kind.Bet).markProcessed(loss, PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
    expect(rollback.status).toBe(Status.Pending);
  });

  it('processes a WIN with or without the BET link', () => {
    const unlinked = create(Kind.Win);
    const linked = create(Kind.Win, { externalTransactionId: 'tx-win-2' });

    unlinked.markProcessed(undefined, PROCESSED_AT);
    linked.markProcessed(create(Kind.Bet), PROCESSED_AT);

    expect(unlinked.referenceTransactionId).toBeUndefined();
    expect(unlinked.referenceKind).toBeUndefined();
    expect(linked.referenceKind).toBe(Kind.Bet);
  });

  it('schedules the pending reference and counts retries only in PENDING_REFERENCE', () => {
    const transaction = create(Kind.Refund);
    const next = new Date('2026-11-26T15:00:04.000Z');

    expect(() => transaction.scheduleReferenceRetry(next)).toThrow(InvalidTransactionStateError);

    transaction.markPendingReference();
    expect(transaction.nextReferenceAttemptAt).toBe(CREATED_AT);
    expect(transaction.referenceAttempts).toBe(0);

    transaction.scheduleReferenceRetry(next);
    expect(transaction.status).toBe(Status.PendingReference);
    expect(transaction.referenceAttempts).toBe(1);
    expect(transaction.nextReferenceAttemptAt).toBe(next);

    transaction.reject(FailureCode.ReferenceNotFound);
    expect(transaction.nextReferenceAttemptAt).toBeUndefined();
    expect(() => transaction.scheduleReferenceRetry(next)).toThrow(InvalidTransactionStateError);
  });

  it('stores the observed balance as a decimal string', () => {
    const transaction = create(Kind.Bet);

    expect(transaction.resultBalance).toBeUndefined();
    transaction.observeBalance(brl('90.00'));
    transaction.markProcessed(undefined, PROCESSED_AT);

    expect(transaction.resultBalance?.toJSON()).toEqual({ amount: '90.00', currency: 'BRL' });
  });
});

describe('WagerTransaction.create', () => {
  it('starts in PENDING with a UUIDv7 id and no result fields', () => {
    const transaction = create(Kind.Bet);

    expect(transaction.status).toBe(Status.Pending);
    expect(transaction.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    expect(transaction.money.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(transaction.createdAt).toBe(CREATED_AT);
    expect(transaction.updatedAt).toBe(CREATED_AT);
    expect(transaction.referenceAttempts).toBe(0);
    expect(transaction.failureCode).toBeUndefined();
    expect(transaction.processedAt).toBeUndefined();
    expect(transaction.referenceTransactionId).toBeUndefined();
  });

  it('requires a reference for REFUND and ROLLBACK', () => {
    for (const kind of [Kind.Refund, Kind.Rollback]) {
      expect(() => create(kind, { referenceExternalTransactionId: undefined })).toThrow(
        InvalidTransactionReferenceError,
      );
    }
  });

  it('forbids a reference for OPENING, BET and LOSS and accepts it optionally for WIN', () => {
    for (const kind of [Kind.Opening, Kind.Bet, Kind.Loss]) {
      expect(() => create(kind, { referenceExternalTransactionId: 'tx-ref' })).toThrow(
        InvalidTransactionReferenceError,
      );
    }

    const unlinkedWin = create(Kind.Win, { referenceExternalTransactionId: undefined });

    expect(create(Kind.Win).referenceExternalTransactionId).toBe('tx-ref');
    expect(unlinkedWin.referenceExternalTransactionId).toBeUndefined();
  });
});

describe('WagerTransaction.opening', () => {
  it('creates an internal OPENING in PENDING with an identity derived from the wallet', () => {
    const walletId = '0192f2a0-0000-7000-8000-000000000009';
    const opening = WagerTransaction.opening({
      walletId,
      playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
      money: brl('100.00'),
      createdAt: CREATED_AT,
    });

    expect(opening.kind).toBe(Kind.Opening);
    expect(opening.status).toBe(Status.Pending);
    expect(opening.providerId).toBe(INTERNAL_PROVIDER_ID);
    expect(opening.externalTransactionId).toBe(`opening-${walletId}`);
    expect(opening.idempotencyKey).toBe(`internal:opening-${walletId}`);
    expect(opening.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{1,255}$/);
    expect(opening.payloadHash).toMatch(/^v[0-9]+:[0-9a-f]{64}$/);
    expect(opening.referenceExternalTransactionId).toBeUndefined();
    expect(opening.affectsBalance()).toBe(true);
    expect(opening.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it('does not affect the balance when the initial balance is zero (ESCOLHAS #21)', () => {
    const opening = WagerTransaction.opening({
      walletId: '0192f2a0-0000-7000-8000-000000000010',
      playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
      money: brl('0.00'),
      createdAt: CREATED_AT,
    });

    expect(opening.affectsBalance()).toBe(false);
  });
});

describe('WagerTransaction queries', () => {
  it('requiresReference only for REFUND and ROLLBACK', () => {
    const expected = new Set([Kind.Refund, Kind.Rollback]);

    for (const kind of ALL_KINDS) {
      expect(create(kind).requiresReference()).toBe(expected.has(kind));
    }
  });

  it('affectsBalance for every positive kind except LOSS', () => {
    for (const kind of ALL_KINDS) {
      expect(create(kind).affectsBalance()).toBe(kind !== Kind.Loss);
    }
  });

  it('matchesPayload compares the stored hash', () => {
    const transaction = create(Kind.Bet);

    expect(transaction.matchesPayload(`v1:${'a'.repeat(64)}`)).toBe(true);
    expect(transaction.matchesPayload(`v1:${'b'.repeat(64)}`)).toBe(false);
    expect(transaction.matchesPayload(`v2:${'a'.repeat(64)}`)).toBe(false);
  });

  it('acceptsReferenceKind follows REQUISITOS §7 rule 3', () => {
    const allowed: Record<Kind, Kind[]> = {
      [Kind.Opening]: [],
      [Kind.Bet]: [],
      [Kind.Loss]: [],
      [Kind.Win]: [Kind.Bet],
      [Kind.Refund]: [Kind.Bet],
      [Kind.Rollback]: [Kind.Bet, Kind.Win, Kind.Refund],
    };

    for (const kind of ALL_KINDS) {
      for (const referenceKind of ALL_KINDS) {
        expect(create(kind).acceptsReferenceKind(referenceKind)).toBe(
          allowed[kind].includes(referenceKind),
        );
      }
    }
  });
});

describe('WagerTransaction.ledgerDirectionFor', () => {
  const ownDirection: Array<[Kind, LedgerDirection]> = [
    [Kind.Opening, LedgerDirection.Credit],
    [Kind.Bet, LedgerDirection.Debit],
    [Kind.Win, LedgerDirection.Credit],
  ];

  for (const [kind, direction] of ownDirection) {
    it(`${kind} is ${direction}`, () => {
      expect(create(kind).ledgerDirectionFor()).toBe(direction);
    });
  }

  it('WIN linked to a BET is still CREDIT', () => {
    expect(create(Kind.Win).ledgerDirectionFor(create(Kind.Bet))).toBe(LedgerDirection.Credit);
  });

  it('LOSS has no direction', () => {
    expect(() => create(Kind.Loss).ledgerDirectionFor()).toThrow(LedgerDirectionUnavailableError);
  });

  const reversals: Array<[Kind, Kind, LedgerDirection | undefined]> = [
    [Kind.Refund, Kind.Bet, LedgerDirection.Credit],
    [Kind.Refund, Kind.Win, undefined],
    [Kind.Refund, Kind.Refund, undefined],
    [Kind.Refund, Kind.Rollback, undefined],
    [Kind.Refund, Kind.Loss, undefined],
    [Kind.Refund, Kind.Opening, undefined],
    [Kind.Rollback, Kind.Bet, LedgerDirection.Credit],
    [Kind.Rollback, Kind.Win, LedgerDirection.Debit],
    [Kind.Rollback, Kind.Refund, LedgerDirection.Debit],
    [Kind.Rollback, Kind.Rollback, undefined],
    [Kind.Rollback, Kind.Loss, undefined],
    [Kind.Rollback, Kind.Opening, undefined],
  ];

  for (const [kind, referenceKind, direction] of reversals) {
    it(`${kind} of ${referenceKind} is ${direction ?? 'not allowed'}`, () => {
      const transaction = create(kind);
      const reference = create(referenceKind, { externalTransactionId: 'tx-ref' });

      if (direction === undefined) {
        expect(() => transaction.ledgerDirectionFor(reference)).toThrow(
          LedgerDirectionUnavailableError,
        );
        return;
      }

      expect(transaction.ledgerDirectionFor(reference)).toBe(direction);
    });
  }

  it('REFUND and ROLLBACK without the reference have no direction', () => {
    for (const kind of [Kind.Refund, Kind.Rollback]) {
      expect(() => create(kind).ledgerDirectionFor()).toThrow(LedgerDirectionUnavailableError);
    }
  });
});

describe('WagerTransaction.rehydrate', () => {
  it('rebuilds a terminal state without revalidating transitions', () => {
    const transaction = WagerTransaction.rehydrate({
      id: '0192f2a0-0000-7000-8000-0000000000aa',
      providerId: 'provider-a',
      externalTransactionId: 'tx-1',
      idempotencyKey: 'provider-a:tx-1',
      payloadHash: `v1:${'c'.repeat(64)}`,
      walletId: '0192f2a0-0000-7000-8000-000000000001',
      playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: Kind.Rollback,
      amount: '10.00',
      currency: 'BRL',
      referenceExternalTransactionId: 'tx-0',
      referenceTransactionId: '0192f2a0-0000-7000-8000-0000000000ab',
      referenceKind: Kind.Win,
      status: Status.Rejected,
      failureCode: FailureCode.ReversalInsufficientFunds,
      resultBalanceAmount: '5.00',
      resultBalanceCurrency: 'BRL',
      referenceAttempts: 3,
      createdAt: CREATED_AT,
      updatedAt: PROCESSED_AT,
    });

    expect(transaction.status).toBe(Status.Rejected);
    expect(transaction.failureCode).toBe(FailureCode.ReversalInsufficientFunds);
    expect(transaction.referenceKind).toBe(Kind.Win);
    expect(transaction.referenceAttempts).toBe(3);
    expect(transaction.resultBalance?.toJSON()).toEqual({ amount: '5.00', currency: 'BRL' });
    expect(transaction.isTerminal()).toBe(true);
  });
});
