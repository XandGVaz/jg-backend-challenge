import { describe, expect, it } from 'bun:test';
import { FailureCode } from '../../../../shared/domain/failure-code.js';
import { Money } from '../../../../shared/domain/money.js';
import { WagerTransaction } from '../wager-transaction.js';
import { InvalidTransactionStateError } from '../wager-transaction.errors.js';
import { WagerTransactionKind as Kind } from '../wager-transaction-kind.js';
import { WagerTransactionPendingReference } from './wager-transaction-pending-reference.event.js';
import { WagerTransactionProcessed } from './wager-transaction-processed.event.js';
import { WagerTransactionRejected } from './wager-transaction-rejected.event.js';

const CREATED_AT = new Date('2026-11-26T15:00:00.000Z');
const PROCESSED_AT = new Date('2026-11-26T15:00:01.000Z');
const OCCURRED_AT = new Date('2026-11-26T15:00:02.000Z');
const CTX = { correlationId: 'request-1', causationId: 'message-1', occurredAt: OCCURRED_AT };
const TRANSACTION_ID = '0192f2a0-0000-7000-8000-0000000000aa';

function transaction(kind: Kind, reference?: string, id = TRANSACTION_ID): WagerTransaction {
  return WagerTransaction.create({
    id,
    providerId: 'provider-a',
    externalTransactionId: 'tx-1',
    idempotencyKey: 'provider-a:tx-1',
    payloadHash: `v1:${'a'.repeat(64)}`,
    walletId: '0192f2a0-0000-7000-8000-000000000001',
    playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    referenceExternalTransactionId: reference,
    createdAt: CREATED_AT,
  });
}

const BASE = {
  transactionId: TRANSACTION_ID,
  providerId: 'provider-a',
  externalTransactionId: 'tx-1',
  walletId: '0192f2a0-0000-7000-8000-000000000001',
  playerId: '5b0c1f8e-1f5a-4f1e-9c7a-3b1a2c3d4e5f',
  roundId: 'round-1',
  gameId: 'game-1',
  money: { amount: '10.00', currency: 'BRL' },
};

describe('WagerTransactionProcessed', () => {
  it('carries the api.md §13.2 data and the transaction as aggregate', () => {
    const bet = transaction(Kind.Bet);
    bet.markProcessed(undefined, PROCESSED_AT);

    const event = WagerTransactionProcessed.from(
      bet,
      Money.from({ amount: '90.00', currency: 'BRL' }),
      CTX,
    );
    const envelope = event.toEnvelope();

    expect(envelope.eventType).toBe('WagerTransactionProcessed');
    expect(envelope.version).toBe(1);
    expect(envelope.aggregateId).toBe(bet.id);
    expect(envelope.correlationId).toBe('request-1');
    expect(envelope.causationId).toBe('message-1');
    expect(envelope.occurredAt).toBe(OCCURRED_AT.toISOString());
    expect(envelope.data).toEqual({
      ...BASE,
      kind: Kind.Bet,
      balanceAfter: { amount: '90.00', currency: 'BRL' },
      processedAt: PROCESSED_AT.toISOString(),
    });
    expect('referenceExternalTransactionId' in envelope.data).toBe(false);
    expect('referenceTransactionId' in envelope.data).toBe(false);
  });

  it('includes both reference ids of a processed reversal', () => {
    const bet = transaction(Kind.Bet, undefined, '0192f2a0-0000-7000-8000-0000000000ab');
    const refund = transaction(Kind.Refund, 'tx-0');
    refund.markProcessed(bet, PROCESSED_AT);

    const data = WagerTransactionProcessed.from(
      refund,
      Money.from({ amount: '100.00', currency: 'BRL' }),
      CTX,
    ).data;

    expect(data.referenceExternalTransactionId).toBe('tx-0');
    expect(data.referenceTransactionId).toBe(bet.id);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('refuses a transaction that is not PROCESSED', () => {
    const balance = Money.from({ amount: '1.00', currency: 'BRL' });

    expect(() => WagerTransactionProcessed.from(transaction(Kind.Bet), balance, CTX)).toThrow(
      InvalidTransactionStateError,
    );
  });
});

describe('WagerTransactionRejected', () => {
  it('carries failureCode and rejectedAt equal to the event instant', () => {
    const bet = transaction(Kind.Bet);
    bet.reject(FailureCode.InsufficientFunds);

    const envelope = WagerTransactionRejected.from(bet, CTX).toEnvelope();

    expect(envelope.eventType).toBe('WagerTransactionRejected');
    expect(envelope.version).toBe(1);
    expect(envelope.aggregateId).toBe(bet.id);
    expect(envelope.data).toEqual({
      ...BASE,
      kind: Kind.Bet,
      failureCode: FailureCode.InsufficientFunds,
      rejectedAt: OCCURRED_AT.toISOString(),
    });
    expect(envelope.occurredAt).toBe(envelope.data.rejectedAt);
  });

  it('refuses a FAILED transaction: FAILED is infrastructure, not business rejection', () => {
    const bet = transaction(Kind.Bet);
    bet.fail(FailureCode.ProcessingRetriesExhausted);

    expect(() => WagerTransactionRejected.from(bet, CTX)).toThrow(InvalidTransactionStateError);
  });
});

describe('WagerTransactionPendingReference', () => {
  it('carries the reference, attempts and next attempt', () => {
    const rollback = transaction(Kind.Rollback, 'tx-0');
    const next = new Date('2026-11-26T15:00:04.000Z');
    rollback.markPendingReference(next);

    const envelope = WagerTransactionPendingReference.from(rollback, CTX).toEnvelope();

    expect(envelope.eventType).toBe('WagerTransactionPendingReference');
    expect(envelope.version).toBe(1);
    expect(envelope.aggregateId).toBe(rollback.id);
    expect(envelope.data).toEqual({
      ...BASE,
      kind: Kind.Rollback,
      referenceExternalTransactionId: 'tx-0',
      attempts: 0,
      nextAttemptAt: next.toISOString(),
    });
  });

  it('refuses a transaction that is not PENDING_REFERENCE', () => {
    expect(() =>
      WagerTransactionPendingReference.from(transaction(Kind.Refund, 'tx-0'), CTX),
    ).toThrow(InvalidTransactionStateError);
  });
});
