import { SQL } from 'bun';
import { E2E } from './env.js';

let client: SQL | undefined;

/** Conexão direta ao PostgreSQL do Compose, só para asserções (o schema vem do Flyway). */
export function db(): SQL {
  client ??= new SQL(E2E.databaseUrl);
  return client;
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
}

/** Invariante final de todos os testes: saldo materializado == saldo reconstruído pelo ledger. */
export async function ledgerMatchesBalance(
  walletId: string,
): Promise<{ stored: string; rebuilt: string }> {
  const [row] = await db()`
    SELECT w.balance_amount::text AS stored,
           coalesce(sum(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END), 0)::numeric(20,2)::text AS rebuilt
      FROM wallets w
      LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
     WHERE w.id = ${walletId}
     GROUP BY w.balance_amount`;
  return row as { stored: string; rebuilt: string };
}
