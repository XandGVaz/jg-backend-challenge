import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { compose, waitUntil } from './support/compose.js';
import { closeDb, db, ledgerMatchesBalance } from './support/db.js';
import { skipIntegration } from './support/env.js';
import {
  balance,
  createWallet,
  provider,
  submit,
  transactionStatus,
  wager,
  type TestWallet,
} from './support/fixtures.js';
import { post } from './support/http.js';
import { peekDeadLetters, sendRaw } from './support/sqs.js';

// Integração com PostgreSQL e MiniStack reais (REQUISITOS §13); a stack do Compose precisa estar em pé.
const touched: TestWallet[] = [];

async function wallet(amount = '100.00'): Promise<TestWallet> {
  const created = await createWallet(amount);
  touched.push(created);
  return created;
}

function envelope(messageId: string, body: ReturnType<typeof wager>) {
  return JSON.stringify({
    messageId,
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: { ...body, idempotencyKey: `${body.providerId}:${body.externalTransactionId}` },
  });
}

async function expectSqlError(statement: Promise<unknown>, fragment: string): Promise<void> {
  const error = await statement.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(String((error as Error).message)).toContain(fragment);
}

describe.skipIf(skipIntegration)('integração (PostgreSQL + MiniStack reais)', () => {
  afterAll(async () => {
    // Invariante final: saldo materializado == saldo reconstruído pelo ledger.
    for (const { id } of touched) {
      const { stored, rebuilt } = await ledgerMatchesBalance(id);
      expect(stored).toBe(rebuilt);
    }
    await closeDb();
  });

  describe('migrations e constraints', () => {
    it('aplicou a V1 (schema completo) com sucesso', async () => {
      const rows =
        await db()`SELECT version FROM flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank`;
      expect(rows.map((row: { version: string }) => row.version)).toEqual(['1']);
    });

    it('barra no banco saldo negativo, ledger mutável, transação terminal alterada e rodada reaberta', async () => {
      const w = await wallet();
      const p = provider();
      await submit(wager(p, w, 'BET', 'bet-1', '10.00', 'r1'));
      await submit(wager(p, w, 'LOSS', 'loss-1', '0.00', 'r1'));

      await expectSqlError(
        db()`UPDATE wallets SET balance_amount = -1 WHERE id = ${w.id}`,
        'ck_wallets_balance',
      );
      await expectSqlError(
        db()`UPDATE wallet_ledger_entries SET amount = 1 WHERE wallet_id = ${w.id}`,
        'append-only',
      );
      await expectSqlError(
        db()`DELETE FROM wallet_ledger_entries WHERE wallet_id = ${w.id}`,
        'append-only',
      );
      await expectSqlError(
        db()`UPDATE wager_transactions SET status = 'REJECTED', failure_code = 'X' WHERE provider_id = ${p} AND external_transaction_id = 'bet-1'`,
        'terminal',
      );
      await expectSqlError(
        db()`UPDATE rounds SET status = 'OPEN', closed_at = NULL WHERE provider_id = ${p} AND round_id = 'r1'`,
        'cannot reopen',
      );
    });

    it('recusa a segunda wallet do mesmo jogador e moeda (409)', async () => {
      const w = await wallet();
      const { status, body } = await post('/wallets', {
        playerId: w.playerId,
        initialBalance: { amount: '1.00', currency: 'BRL' },
      });
      expect(status).toBe(409);
      expect(body.code).toBe('WALLET_ALREADY_EXISTS');
    });
  });

  describe('atomicidade entre wallet, ledger, inbox e outbox', () => {
    it('aplicada: transação, lançamento da versão nova e os dois eventos no mesmo commit', async () => {
      const w = await wallet();
      const p = provider();
      const { status, body } = await submit(wager(p, w, 'BET', 'bet-1', '30.00', 'r1'));
      expect(status).toBe(201);

      const [tx] =
        await db()`SELECT id, status, result_balance_amount::text AS result FROM wager_transactions WHERE id = ${body.transactionId}`;
      expect(tx.status).toBe('PROCESSED');
      expect(tx.result).toBe('70.00');

      const entries =
        await db()`SELECT direction, wallet_version FROM wallet_ledger_entries WHERE transaction_id = ${tx.id}`;
      const [walletRow] = await db()`SELECT version FROM wallets WHERE id = ${w.id}`;
      expect(entries).toHaveLength(1);
      expect(entries[0].direction).toBe('DEBIT');
      expect(entries[0].wallet_version).toBe(walletRow.version);

      const events = await db()`
        SELECT event_type FROM outbox_messages
         WHERE aggregate_id = ${tx.id} OR (aggregate_id = ${w.id} AND payload->'data'->>'transactionId' = ${tx.id})
         ORDER BY event_type`;
      expect(events.map((row: { event_type: string }) => row.event_type)).toEqual([
        'WagerTransactionProcessed',
        'WalletBalanceChanged',
      ]);
    });

    it('rejeitada: grava a transação e o evento, sem lançamento nem mudança de saldo', async () => {
      const w = await wallet('10.00');
      const p = provider();
      const { status, body } = await submit(wager(p, w, 'BET', 'bet-big', '50.00', 'r1'));
      expect(status).toBe(422);
      expect(body.code).toBe('INSUFFICIENT_FUNDS');

      const txId = body.transactionId as string;
      expect(
        await db()`SELECT 1 FROM wallet_ledger_entries WHERE transaction_id = ${txId}`,
      ).toHaveLength(0);
      const [event] =
        await db()`SELECT event_type FROM outbox_messages WHERE aggregate_id = ${txId}`;
      expect(event.event_type).toBe('WagerTransactionRejected');
      expect(await balance(w.id)).toBe('10.00');
    });

    it('wallet inexistente: 404 e nada gravado', async () => {
      const w = await wallet();
      const p = provider();
      const ghost = { ...w, id: '0192f2a0-0000-7000-8000-00000000dead' };
      const { status } = await submit(wager(p, ghost, 'BET', 'ghost', '1.00', 'r1'));
      expect(status).toBe(404);
      expect(await db()`SELECT 1 FROM wager_transactions WHERE provider_id = ${p}`).toHaveLength(0);
    });

    it('pela fila: inbox marcada no mesmo commit da transação', async () => {
      const w = await wallet();
      const p = provider();
      const messageId = randomUUID();
      await sendRaw(
        envelope(messageId, wager(p, w, 'BET', 'sqs-1', '5.00', 'r1')),
        w.id,
        messageId,
      );

      expect(
        await waitUntil(async () => (await transactionStatus(p, 'sqs-1')) === 'PROCESSED'),
      ).toBe(true);
      const [inbox] =
        await db()`SELECT processed_at FROM inbox_messages WHERE message_id = ${messageId}`;
      expect(inbox.processed_at).not.toBeNull();
    }, 90_000);
  });

  describe('inbox e redelivery', () => {
    it('a mesma mensagem entregue de novo não tem efeito; a mesma operação com outro messageId é replay', async () => {
      const w = await wallet();
      const p = provider();
      const body = wager(p, w, 'BET', 'dup-1', '7.00', 'r1');
      const messageId = randomUUID();

      // Mesmo messageId com outro dedup id do SQS: o broker entrega duas vezes, a inbox barra a segunda.
      await sendRaw(envelope(messageId, body), w.id, `${messageId}-a`);
      await sendRaw(envelope(messageId, body), w.id, `${messageId}-b`);
      // Outro messageId para a mesma operação: deduplicado pela Idempotency-Key.
      const other = randomUUID();
      await sendRaw(envelope(other, body), w.id, other);

      expect(
        await waitUntil(async () => {
          const rows =
            await db()`SELECT count(*)::int AS n FROM inbox_messages WHERE message_id IN (${messageId}, ${other}) AND processed_at IS NOT NULL`;
          return rows[0].n === 2;
        }),
      ).toBe(true);
      const [debits] = await db()`
        SELECT count(*)::int AS n FROM wallet_ledger_entries WHERE wallet_id = ${w.id} AND direction = 'DEBIT'`;
      expect(debits.n).toBe(1);
      expect(await balance(w.id)).toBe('93.00');
    }, 90_000);
  });

  describe('retry e DLQ', () => {
    it('corpo inválido vai para a DLQ com o motivo invalid_message', async () => {
      const marker = randomUUID();
      await sendRaw(JSON.stringify({ marker, not: 'a wager message' }), 'invalid', marker);

      expect(
        await waitUntil(
          async () => {
            const letters = await peekDeadLetters();
            return letters.some(
              (letter) => letter.body.includes(marker) && letter.reason === 'invalid_message',
            );
          },
          60_000,
          1_000,
        ),
      ).toBe(true);
    }, 90_000);

    it('falha transitória (banco fora) volta com backoff e é processada uma vez quando o banco volta', async () => {
      const w = await wallet();
      const p = provider();
      const messageId = randomUUID();

      await compose('stop', 'database');
      try {
        await sendRaw(
          envelope(messageId, wager(p, w, 'BET', 'during-outage', '4.00', 'r1')),
          w.id,
          messageId,
        );
        await Bun.sleep(6_000);
      } finally {
        await compose('start', 'database');
      }

      expect(
        await waitUntil(
          async () =>
            (await transactionStatus(p, 'during-outage').catch(() => undefined)) === 'PROCESSED',
          120_000,
          1_000,
        ),
      ).toBe(true);
      expect(await balance(w.id)).toBe('96.00');
    }, 180_000);
  });

  describe('recuperação após reinicialização', () => {
    it('o worker reiniciado retoma a PENDING_REFERENCE e a outbox drena', async () => {
      const w = await wallet();
      const p = provider();
      const refund = await submit(wager(p, w, 'REFUND', 'refund-early', '10.00', 'r1', 'bet-late'));
      expect(refund.status).toBe(202);

      await compose('restart', 'worker');
      const bet = await submit(wager(p, w, 'BET', 'bet-late', '10.00', 'r1'));
      expect(bet.status).toBe(201);

      expect(
        await waitUntil(
          async () => (await transactionStatus(p, 'refund-early')) === 'PROCESSED',
          60_000,
          1_000,
        ),
      ).toBe(true);
      expect(await balance(w.id)).toBe('100.00');
      expect(
        await waitUntil(
          async () => {
            const [row] = await db()`
            SELECT count(*)::int AS n FROM outbox_messages o
              JOIN wager_transactions t ON t.id = o.aggregate_id
             WHERE t.provider_id = ${p} AND o.published_at IS NULL`;
            return row.n === 0;
          },
          30_000,
          1_000,
        ),
      ).toBe(true);
    }, 120_000);
  });
});
