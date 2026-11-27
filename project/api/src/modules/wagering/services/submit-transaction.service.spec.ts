import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { EntityManager } from '@mikro-orm/postgresql';
import { FailureCode } from '../../../shared/domain/failure-code.js';
import { Money } from '../../../shared/domain/money.js';
import { TransactionRejectedError } from '../../../shared/errors/index.js';
import type { ProviderIdentityPort } from '../../auth/domain/provider-identity.port.js';
import type { InboxService } from '../../inbox/services/inbox.service.js';
import type { OutboxService } from '../../outbox/services/outbox.service.js';
import { RoundClosedError } from '../../rounds/domain/round-closed.error.js';
import type { RoundsService } from '../../rounds/services/rounds.service.js';
import { DuplicateTransactionError } from '../../transactions/domain/wager-transaction.errors.js';
import { WagerTransactionKind } from '../../transactions/domain/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../transactions/domain/wager-transaction-status.js';
import {
  WagerTransaction,
  type CreateWagerTransactionProps,
} from '../../transactions/domain/wager-transaction.js';
import type { TransactionsService } from '../../transactions/services/transactions.service.js';
import type { WalletLedgerEntry } from '../../wallets/domain/wallet-ledger-entry.js';
import { Wallet } from '../../wallets/domain/wallet.js';
import { WalletNotFoundError } from '../../wallets/domain/wallet.errors.js';
import type { WalletsService } from '../../wallets/services/wallets.service.js';
import type { SubmitTransactionRequest } from '../wagering.schema.js';
import { SubmitTransactionService } from './submit-transaction.service.js';

process.env.DATABASE_URL ??= 'postgres://u:p@localhost:5432/test';

const PLAYER = '00000000-0000-4000-8000-000000000001';
const PROVIDER = 'provider-a';

/** Colaboradores em memória com o domínio real: o teste exercita as regras de REQUISITOS §7. */
function setup(initialBalance = '100.00') {
  const wallet = Wallet.open({
    playerId: PLAYER,
    initialBalance: Money.from({ amount: initialBalance, currency: 'BRL' }),
  });
  const store = new Map<string, WagerTransaction>();
  const entries: WalletLedgerEntry[] = [];
  const events: string[] = [];
  const rounds = { closed: new Set<string>() };

  const transactions = {
    register: async (props: CreateWagerTransactionProps) => {
      const tx = WagerTransaction.create(props);
      store.set(tx.id, tx);
      return tx;
    },
    findByIdempotencyKey: async (key: string) =>
      [...store.values()].find((tx) => tx.idempotencyKey === key),
    findById: async (id: string) => store.get(id),
    findReferenceForUpdate: async (tx: WagerTransaction) =>
      [...store.values()].find(
        (candidate) =>
          candidate.providerId === tx.providerId &&
          candidate.externalTransactionId === tx.referenceExternalTransactionId,
      ),
    findProcessedReversals: async (ref: WagerTransaction) =>
      [...store.values()].filter(
        (tx) =>
          tx.referenceTransactionId === ref.id &&
          tx.status === WagerTransactionStatus.Processed &&
          (tx.kind === WagerTransactionKind.Refund || tx.kind === WagerTransactionKind.Rollback),
      ),
    isCancelledBet: async (bet: WagerTransaction) =>
      [...store.values()].some(
        (tx) =>
          tx.kind === WagerTransactionKind.Refund &&
          tx.status === WagerTransactionStatus.Rejected &&
          tx.referenceExternalTransactionId === bet.externalTransactionId,
      ),
    expediteWaitingFor: async () => 0,
  } as unknown as TransactionsService;

  const wallets = {
    get: async (id: string) => {
      if (id !== wallet.id) throw new WalletNotFoundError(id);
      return wallet;
    },
    commit: async (_wallet: Wallet, _expected: number, entry: WalletLedgerEntry) => {
      entries.push(entry);
    },
  } as unknown as WalletsService;

  const registerResult = mock(async (_provider: string, roundId: string) => {
    rounds.closed.add(roundId);
  });
  const roundsService = {
    assertBetAllowed: async (_provider: string, roundId: string) => {
      if (rounds.closed.has(roundId)) throw new RoundClosedError(PROVIDER, roundId);
    },
    registerResult,
  } as unknown as RoundsService;

  const outbox = {
    enqueue: (event: { eventType: string }) => events.push(event.eventType),
  } as unknown as OutboxService;
  const inbox = {
    receive: async () => 'new',
    markProcessed: async () => undefined,
  } as unknown as InboxService;
  const identity = { assertCanActAs: () => undefined } as unknown as ProviderIdentityPort;
  const em = {
    transactional: (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  } as unknown as EntityManager;

  const service = new SubmitTransactionService(
    em,
    transactions,
    wallets,
    roundsService,
    outbox,
    inbox,
    identity,
  );

  const body = (
    kind: SubmitTransactionRequest['kind'],
    externalTransactionId: string,
    amount: string,
    roundId = 'r1',
    referenceExternalTransactionId?: string,
    currency = 'BRL',
  ): SubmitTransactionRequest => ({
    providerId: PROVIDER,
    externalTransactionId,
    playerId: PLAYER,
    walletId: wallet.id,
    roundId,
    gameId: 'g1',
    kind,
    money: { amount, currency },
    ...(referenceExternalTransactionId && { referenceExternalTransactionId }),
  });

  const send = (request: SubmitTransactionRequest) =>
    service.submit(request, `${PROVIDER}:${request.externalTransactionId}`, 'http');

  const rejection = async (request: SubmitTransactionRequest): Promise<string> => {
    const error = await send(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransactionRejectedError);
    return (error as TransactionRejectedError).code;
  };

  return { wallet, entries, events, registerResult, store, service, body, send, rejection };
}

describe('SubmitTransactionService', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  describe('BET', () => {
    it('debita, grava PROCESSED com o saldo observado e emite os eventos', async () => {
      const result = await ctx.send(ctx.body('BET', 'bet-1', '30.00'));

      expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.toJSON().amount).toBe('70.00');
      expect(ctx.entries).toHaveLength(1);
      expect(ctx.events).toContain('WagerTransactionProcessed');
    });

    it('sem saldo: REJECTED com INSUFFICIENT_FUNDS, sem lançamento e saldo intacto', async () => {
      expect(await ctx.rejection(ctx.body('BET', 'bet-1', '100.01'))).toBe(
        FailureCode.InsufficientFunds,
      );
      expect(ctx.entries).toHaveLength(0);
      expect(ctx.wallet.balance.toJSON().amount).toBe('100.00');
      expect(ctx.events).toEqual(['WagerTransactionRejected']);
    });

    it('em rodada já fechada: ROUND_CLOSED', async () => {
      await ctx.send(ctx.body('LOSS', 'loss-1', '0.00'));
      expect(await ctx.rejection(ctx.body('BET', 'bet-1', '1.00'))).toBe(FailureCode.RoundClosed);
    });

    it('cancelada antes de chegar por um REFUND rejeitado: BET_ALREADY_CANCELLED', async () => {
      const refund = await ctx.send(ctx.body('REFUND', 'refund-1', '5.00', 'r1', 'bet-1'));
      refund.transaction.reject(FailureCode.ReferenceNotFound);

      expect(await ctx.rejection(ctx.body('BET', 'bet-1', '5.00'))).toBe(
        FailureCode.BetAlreadyCancelled,
      );
    });
  });

  describe('WIN e LOSS', () => {
    it('WIN credita e fecha a rodada; com a BET referenciada, grava a ligação', async () => {
      await ctx.send(ctx.body('BET', 'bet-1', '10.00'));
      const win = await ctx.send(ctx.body('WIN', 'win-1', '25.00', 'r1', 'bet-1'));

      expect(win.balance.toJSON().amount).toBe('115.00');
      expect(win.transaction.referenceKind).toBe(WagerTransactionKind.Bet);
      expect(ctx.registerResult).toHaveBeenCalled();
    });

    it('WIN com referência inexistente é processado sem ligação (ESCOLHAS #21)', async () => {
      const win = await ctx.send(ctx.body('WIN', 'win-1', '5.00', 'r9', 'missing-bet'));

      expect(win.transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(win.transaction.referenceTransactionId).toBeUndefined();
    });

    it('LOSS não move saldo nem gera lançamento', async () => {
      const loss = await ctx.send(ctx.body('LOSS', 'loss-1', '0.00'));

      expect(loss.transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(ctx.entries).toHaveLength(0);
      expect(loss.balance.toJSON().amount).toBe('100.00');
    });
  });

  describe('REFUND', () => {
    it('credita a BET referenciada', async () => {
      await ctx.send(ctx.body('BET', 'bet-1', '20.00'));
      const refund = await ctx.send(ctx.body('REFUND', 'refund-1', '20.00', 'r1', 'bet-1'));

      expect(refund.balance.toJSON().amount).toBe('100.00');
    });

    it('referência ausente: PENDING_REFERENCE e evento de pendência', async () => {
      const refund = await ctx.send(ctx.body('REFUND', 'refund-1', '20.00', 'r1', 'bet-late'));

      expect(refund.transaction.status).toBe(WagerTransactionStatus.PendingReference);
      expect(ctx.events).toContain('WagerTransactionPendingReference');
    });

    it('valor diferente da referência: REVERSAL_AMOUNT_MISMATCH', async () => {
      await ctx.send(ctx.body('BET', 'bet-1', '20.00'));
      expect(await ctx.rejection(ctx.body('REFUND', 'refund-1', '19.99', 'r1', 'bet-1'))).toBe(
        FailureCode.ReversalAmountMismatch,
      );
    });

    it('referência que não é BET: REFERENCE_KIND_NOT_ALLOWED', async () => {
      await ctx.send(ctx.body('WIN', 'win-1', '10.00'));
      expect(await ctx.rejection(ctx.body('REFUND', 'refund-1', '10.00', 'r1', 'win-1'))).toBe(
        FailureCode.ReferenceKindNotAllowed,
      );
    });

    it('referência de outra rodada: REFERENCE_MISMATCH', async () => {
      await ctx.send(ctx.body('BET', 'bet-1', '10.00', 'r1'));
      expect(await ctx.rejection(ctx.body('REFUND', 'refund-1', '10.00', 'r2', 'bet-1'))).toBe(
        FailureCode.ReferenceMismatch,
      );
    });
  });

  describe('ROLLBACK', () => {
    it('de um WIN debita o prêmio', async () => {
      await ctx.send(ctx.body('WIN', 'win-1', '40.00'));
      const rollback = await ctx.send(ctx.body('ROLLBACK', 'rb-1', '40.00', 'r1', 'win-1'));

      expect(rollback.balance.toJSON().amount).toBe('100.00');
    });

    it('de um WIN já gasto: REVERSAL_INSUFFICIENT_FUNDS, distinto da aposta sem saldo', async () => {
      await ctx.send(ctx.body('WIN', 'win-1', '40.00', 'r1'));
      await ctx.send(ctx.body('BET', 'bet-1', '130.00', 'r2'));

      expect(await ctx.rejection(ctx.body('ROLLBACK', 'rb-1', '40.00', 'r1', 'win-1'))).toBe(
        FailureCode.ReversalInsufficientFunds,
      );
    });

    it('uma BET já reembolsada não aceita ROLLBACK: um estorno por BET (ESCOLHAS #21)', async () => {
      await ctx.send(ctx.body('BET', 'bet-1', '20.00'));
      await ctx.send(ctx.body('REFUND', 'refund-1', '20.00', 'r1', 'bet-1'));

      expect(await ctx.rejection(ctx.body('ROLLBACK', 'rb-1', '20.00', 'r1', 'bet-1'))).toBe(
        FailureCode.ReferenceAlreadyReversed,
      );
    });
  });

  describe('wallet e moeda', () => {
    it('moeda diferente da wallet: CURRENCY_MISMATCH', async () => {
      expect(await ctx.rejection(ctx.body('BET', 'bet-1', '1.00', 'r1', undefined, 'USD'))).toBe(
        FailureCode.CurrencyMismatch,
      );
    });

    it('wallet de outro jogador: WALLET_PLAYER_MISMATCH', async () => {
      const request = {
        ...ctx.body('BET', 'bet-1', '1.00'),
        playerId: '00000000-0000-4000-8000-000000000002',
      };
      expect(await ctx.rejection(request)).toBe(FailureCode.WalletPlayerMismatch);
    });

    it('wallet inexistente: 404 sem gravar nada', async () => {
      const request = {
        ...ctx.body('BET', 'bet-1', '1.00'),
        walletId: '0192f2a0-0000-7000-8000-00000000dead',
      };
      const error = await ctx.send(request).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(WalletNotFoundError);
      expect(ctx.store.size).toBe(0);
    });
  });

  describe('idempotência', () => {
    it('mesma key e mesmo payload: replay com o resultado original, sem novo efeito', async () => {
      const first = await ctx.send(ctx.body('BET', 'bet-1', '30.00'));
      const replay = await ctx.send(ctx.body('BET', 'bet-1', '30.00'));

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.transaction.id).toBe(first.transaction.id);
      expect(replay.balance.toJSON().amount).toBe('70.00');
      expect(ctx.entries).toHaveLength(1);
    });

    it('mesma key com payload divergente é conflito, não replay', async () => {
      await ctx.send(ctx.body('BET', 'bet-1', '30.00'));
      const error = await ctx
        .send(ctx.body('BET', 'bet-1', '31.00'))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DuplicateTransactionError);
      expect(ctx.entries).toHaveLength(1);
    });

    it('replay de uma rejeição devolve o mesmo 422', async () => {
      await ctx.rejection(ctx.body('BET', 'bet-1', '500.00'));
      expect(await ctx.rejection(ctx.body('BET', 'bet-1', '500.00'))).toBe(
        FailureCode.InsufficientFunds,
      );
    });
  });
});
