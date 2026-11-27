import { describe, expect, it, mock } from 'bun:test';
import { TransactionRejectedError } from '../../../shared/errors/index.js';
import { MessageOutcome, type ReceivedMessage } from '../../../shared/messaging/message-handler.js';
import { DependencyUnavailableError } from '../../../shared/errors/dependency-unavailable.error.js';
import { WalletNotFoundError } from '../../wallets/domain/wallet.errors.js';
import type { SubmitTransactionService } from '../services/submit-transaction.service.js';
import { WagerTransactionsHandler } from './wager-transactions.handler.js';

const data = {
  providerId: 'provider-a',
  externalTransactionId: 'bet-1',
  playerId: '00000000-0000-4000-8000-000000000001',
  walletId: '0192f2a0-0000-7000-8000-000000000001',
  roundId: 'r1',
  gameId: 'g1',
  kind: 'BET',
  money: { amount: '10.00', currency: 'BRL' },
  idempotencyKey: 'provider-a:bet-1',
};

const message = (body: unknown, receiveCount = 1): ReceivedMessage => ({
  sqsMessageId: 'sqs-1',
  body: typeof body === 'string' ? body : JSON.stringify(body),
  groupId: data.walletId,
  receiveCount,
  attributes: {},
});

const envelope = {
  messageId: 'msg-1',
  type: 'WagerTransactionRequested',
  occurredAt: '2026-11-27T00:00:00.000Z',
  data,
};

function handlerFailingWith(error?: unknown) {
  const submit = mock(async () => {
    if (error) throw error;
    return {};
  });
  const failExhausted = mock(async () => undefined);
  const service = { submit, failExhausted } as unknown as SubmitTransactionService;
  return { handler: new WagerTransactionsHandler(service, 5), submit, failExhausted };
}

describe('WagerTransactionsHandler', () => {
  it('acks a processed message and passes the inbox key and the idempotency key', async () => {
    const { handler, submit } = handlerFailingWith();

    expect((await handler.handle(message(envelope))).outcome).toBe(MessageOutcome.Ack);
    const [input, key, channel, inbox] = submit.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
      string,
      unknown,
    ];
    expect(input.idempotencyKey).toBeUndefined();
    expect(key).toBe('provider-a:bet-1');
    expect(channel).toBe('sqs');
    expect(inbox).toEqual({ consumerName: 'wager-transactions', messageId: 'msg-1' });
  });

  it('sends invalid JSON and invalid envelopes to the DLQ without calling the service', async () => {
    const { handler, submit } = handlerFailingWith();

    expect(await handler.handle(message('not json'))).toEqual({
      outcome: MessageOutcome.DeadLetter,
      reason: 'invalid_message',
    });
    expect(
      await handler.handle(message({ ...envelope, data: { ...data, kind: 'OPENING' } })),
    ).toEqual({
      outcome: MessageOutcome.DeadLetter,
      reason: 'invalid_message',
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('acks business results: a rejection and an unknown wallet', async () => {
    expect(
      (
        await handlerFailingWith(
          new TransactionRejectedError('INSUFFICIENT_FUNDS', 'tx'),
        ).handler.handle(message(envelope))
      ).outcome,
    ).toBe(MessageOutcome.Ack);
    expect(
      (await handlerFailingWith(new WalletNotFoundError('w')).handler.handle(message(envelope)))
        .outcome,
    ).toBe(MessageOutcome.Ack);
  });

  it('retries a transient failure before the last delivery', async () => {
    const { handler, failExhausted } = handlerFailingWith(
      new DependencyUnavailableError('PostgreSQL'),
    );

    expect((await handler.handle(message(envelope, 4))).outcome).toBe(MessageOutcome.Retry);
    expect(failExhausted).not.toHaveBeenCalled();
  });

  it('records FAILED and dead-letters on the last delivery', async () => {
    const { handler, failExhausted } = handlerFailingWith(
      new DependencyUnavailableError('PostgreSQL'),
    );

    expect(await handler.handle(message(envelope, 5))).toEqual({
      outcome: MessageOutcome.DeadLetter,
      reason: 'retries_exhausted',
    });
    expect(failExhausted).toHaveBeenCalledTimes(1);
  });
});
