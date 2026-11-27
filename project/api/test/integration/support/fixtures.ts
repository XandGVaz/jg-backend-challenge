import { randomUUID } from 'node:crypto';
import { get, post } from './http.js';

export type Kind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export interface TestWallet {
  id: string;
  playerId: string;
}

/** Provedor próprio por execução: as Idempotency-Keys não colidem entre rodadas da suíte. */
export const provider = () => `it-${randomUUID().slice(0, 8)}`;

export async function createWallet(amount: string): Promise<TestWallet> {
  const playerId = randomUUID();
  const { status, body } = await post<{ id: string }>('/wallets', {
    playerId,
    initialBalance: { amount, currency: 'BRL' },
  });
  if (status !== 201) throw new Error(`POST /wallets returned ${status}`);
  return { id: body.id, playerId };
}

export function wager(
  providerId: string,
  wallet: TestWallet,
  kind: Kind,
  externalTransactionId: string,
  amount: string,
  roundId: string,
  referenceExternalTransactionId?: string,
) {
  return {
    providerId,
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId,
    gameId: 'it-game',
    kind,
    money: { amount, currency: 'BRL' },
    ...(referenceExternalTransactionId && { referenceExternalTransactionId }),
  };
}

export function submit(body: ReturnType<typeof wager>) {
  return post('/wagering/transactions', body, {
    'Idempotency-Key': `${body.providerId}:${body.externalTransactionId}`,
  });
}

export async function balance(walletId: string): Promise<string> {
  const { body } = await get<{ balance: { amount: string } }>(`/wallets/${walletId}`);
  return body.balance.amount;
}

export async function transactionStatus(
  providerId: string,
  externalId: string,
): Promise<string | undefined> {
  const { status, body } = await get<{ status: string }>(
    `/providers/${providerId}/wagering/transactions/${externalId}`,
  );
  return status === 200 ? body.status : undefined;
}
