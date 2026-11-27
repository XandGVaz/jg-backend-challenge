import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { compose, runningReplicas, waitUntil } from './support/compose.js';
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
import { sendRaw } from './support/sqs.js';

// Concorrência com paralelismo real contra 3 réplicas da api e 2 do worker (REQUISITOS §13).
const touched: TestWallet[] = [];

async function wallet(amount = '100.00'): Promise<TestWallet> {
  const created = await createWallet(amount);
  touched.push(created);
  return created;
}

async function debits(walletId: string): Promise<number> {
  const [row] =
    await db()`SELECT count(*)::int AS n FROM wallet_ledger_entries WHERE wallet_id = ${walletId} AND direction = 'DEBIT'`;
  return row.n;
}

describe.skipIf(skipIntegration)('concorrência (paralelismo real)', () => {
  afterAll(async () => {
    for (const { id } of touched) {
      const { stored, rebuilt } = await ledgerMatchesBalance(id);
      expect(stored).toBe(rebuilt);
    }
    await closeDb();
  });

  it('1. a mesma aposta enviada 50 vezes em paralelo gera um único débito', async () => {
    const w = await wallet();
    const p = provider();
    const body = wager(p, w, 'BET', 'same-bet', '10.00', 'r1');

    const results = await Promise.all(Array.from({ length: 50 }, () => submit(body)));

    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(new Set(results.map((result) => result.body.transactionId)).size).toBe(1);
    expect(results.filter((result) => result.body.idempotentReplay === false)).toHaveLength(1);
    expect(await debits(w.id)).toBe(1);
    expect(await balance(w.id)).toBe('90.00');
  }, 60_000);

  it('2. duas apostas de 80,00 sobre 100,00 ao mesmo tempo: uma aplicada, uma rejeitada, saldo 20,00', async () => {
    // Repetido em wallets novas para a corrida não depender de sorte.
    for (let round = 0; round < 5; round++) {
      const w = await wallet();
      const p = provider();
      const results = await Promise.all([
        submit(wager(p, w, 'BET', 'a', '80.00', 'r1')),
        submit(wager(p, w, 'BET', 'b', '80.00', 'r2')),
      ]);

      expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([201, 422]);
      expect(results.find((result) => result.status === 422)?.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(await balance(w.id)).toBe('20.00');
      expect(await debits(w.id)).toBe(1);
    }
  }, 120_000);

  it('3. wallets distintas processadas em paralelo não interferem entre si', async () => {
    const wallets = await Promise.all(Array.from({ length: 20 }, () => wallet('50.00')));
    const p = provider();

    // Em sequência dentro de cada wallet e em paralelo entre wallets: a disputa na mesma wallet é o cenário 2.
    await Promise.all(
      wallets.map(async (w, index) => {
        for (let bet = 0; bet < 10; bet++) {
          const { status } = await submit(
            wager(p, w, 'BET', `w${index}-b${bet}`, '1.00', `r-${index}-${bet}`),
          );
          expect(status).toBe(201);
        }
      }),
    );

    for (const w of wallets) {
      expect(await balance(w.id)).toBe('40.00');
      expect(await debits(w.id)).toBe(10);
    }
  }, 120_000);

  it('4. ≥ 3 instâncias da api atendem a mesma carga simultânea', async () => {
    expect(await runningReplicas('api')).toBeGreaterThanOrEqual(3);
    const since = new Date().toISOString();
    const w = await wallet('1000.00');
    const p = provider();

    const results = await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        submit(wager(p, w, 'BET', `inst-${index}`, '1.00', `r${index}`)),
      ),
    );
    expect(results.every((result) => result.status === 201 || result.status === 503)).toBe(true);

    const logs = await compose('logs', '--no-log-prefix', '--since', since, 'nginx');
    const upstreams = new Set(
      logs
        .split('\n')
        .filter((line) => line.includes('/wagering/transactions'))
        .map((line) => /"upstream":"([^"]+)"/.exec(line)?.[1])
        .filter(Boolean),
    );
    expect(upstreams.size).toBeGreaterThanOrEqual(3);

    const applied = results.filter((result) => result.status === 201).length;
    expect(await debits(w.id)).toBe(applied);
  }, 60_000);

  it('5. worker morto depois do commit e antes do ack: cada mensagem tem efeito exatamente uma vez', async () => {
    const wallets = await Promise.all(Array.from({ length: 4 }, () => wallet()));
    const p = provider();
    const messages = wallets.flatMap((w, index) =>
      Array.from({ length: 10 }, (_, bet) => {
        const body = wager(p, w, 'BET', `kill-${index}-${bet}`, '1.00', `r-${index}-${bet}`);
        const messageId = randomUUID();
        return { w, messageId, body };
      }),
    );

    for (const { w, messageId, body } of messages) {
      const envelope = JSON.stringify({
        messageId,
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: { ...body, idempotencyKey: `${p}:${body.externalTransactionId}` },
      });
      await sendRaw(envelope, w.id, messageId);
    }

    // SIGKILL no meio do processamento: mensagens já commitadas ficam sem ack e voltam depois do visibility timeout.
    await Bun.sleep(400);
    await compose('kill', '-s', 'SIGKILL', 'worker');
    await compose('up', '-d', '--scale', 'worker=2', '--wait', 'worker');

    expect(
      await waitUntil(
        async () => {
          const [row] = await db()`
          SELECT count(*)::int AS n FROM wager_transactions WHERE provider_id = ${p} AND status = 'PROCESSED'`;
          return row.n === messages.length;
        },
        150_000,
        2_000,
      ),
    ).toBe(true);

    for (const w of wallets) {
      expect(await debits(w.id)).toBe(10);
      expect(await balance(w.id)).toBe('90.00');
    }
    const [inbox] = await db()`
      SELECT count(*)::int AS n FROM inbox_messages WHERE message_id IN ${db()(messages.map((m) => m.messageId))}`;
    expect(inbox.n).toBe(messages.length);
  }, 240_000);

  it('6. dois publishers sobre a mesma outbox publicam cada evento uma vez, sem perder nenhum', async () => {
    expect(await runningReplicas('worker')).toBeGreaterThanOrEqual(2);
    const w = await wallet('1000.00');
    const p = provider();
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        submit(wager(p, w, 'BET', `pub-${index}`, '1.00', `r${index}`)),
      ),
    );
    // Um WalletBalanceChanged por lançamento: o de abertura mais um por aposta aplicada.
    const expected = 1 + results.filter((result) => result.status === 201).length;

    expect(
      await waitUntil(
        async () => {
          const [row] = await db()`
          SELECT count(*) FILTER (WHERE published_at IS NULL)::int AS pending, count(*)::int AS total
            FROM outbox_messages WHERE aggregate_id = ${w.id}`;
          return row.total === expected && row.pending === 0;
        },
        60_000,
        1_000,
      ),
    ).toBe(true);

    // Publicação bem-sucedida não reagenda: nenhuma linha passou por scheduleRetry.
    const [retried] =
      await db()`SELECT count(*)::int AS n FROM outbox_messages WHERE aggregate_id = ${w.id} AND attempts > 0`;
    expect(retried.n).toBe(0);
  }, 90_000);

  it('7. REFUND e ROLLBACK entregues antes da referência ficam pendentes e se resolvem quando ela chega', async () => {
    const w = await wallet();
    const p = provider();

    expect(
      (await submit(wager(p, w, 'REFUND', 'refund-first', '20.00', 'r1', 'bet-r1'))).status,
    ).toBe(202);
    expect((await submit(wager(p, w, 'BET', 'bet-r2', '30.00', 'r2'))).status).toBe(201);
    expect(
      (await submit(wager(p, w, 'ROLLBACK', 'rollback-first', '15.00', 'r2', 'win-r2'))).status,
    ).toBe(202);

    expect((await submit(wager(p, w, 'BET', 'bet-r1', '20.00', 'r1'))).status).toBe(201);
    expect((await submit(wager(p, w, 'WIN', 'win-r2', '15.00', 'r2', 'bet-r2'))).status).toBe(201);

    expect(
      await waitUntil(
        async () =>
          (await transactionStatus(p, 'refund-first')) === 'PROCESSED' &&
          (await transactionStatus(p, 'rollback-first')) === 'PROCESSED',
        60_000,
        1_000,
      ),
    ).toBe(true);
    // 100 - 20 + 20 (refund) - 30 + 15 (win) - 15 (rollback do win) = 70
    expect(await balance(w.id)).toBe('70.00');
  }, 90_000);

  it('8. reinício da api e do worker com consistência final comprovada', async () => {
    const w = await wallet();
    const p = provider();
    const inflight = Promise.allSettled(
      Array.from({ length: 30 }, (_, index) =>
        submit(wager(p, w, 'BET', `restart-${index}`, '1.00', `r${index}`)),
      ),
    );

    await compose('restart', 'api', 'worker');
    await inflight;
    await compose('up', '-d', '--scale', 'api=3', '--scale', 'worker=2', '--wait', 'api', 'worker');

    const [row] = await db()`
      SELECT count(*) FILTER (WHERE status = 'PROCESSED')::int AS processed,
             count(*) FILTER (WHERE status = 'PENDING')::int AS stuck
        FROM wager_transactions WHERE provider_id = ${p}`;
    expect(row.stuck).toBe(0);
    expect(await debits(w.id)).toBe(row.processed);

    for (const { id } of touched) {
      const { stored, rebuilt } = await ledgerMatchesBalance(id);
      expect(stored).toBe(rebuilt);
    }
  }, 180_000);
});
