import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import type { LedgerCursor } from '../ledger-cursor.js';

/** Ledger append-only: só INSERT e leitura na ordem (created_at, id). */
@Injectable()
export class WalletLedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async add(entry: WalletLedgerEntry): Promise<void> {
    await this.em.insert(entry);
  }

  /** Keyset: `limit + 1` linhas depois do cursor, para saber se há próxima página sem COUNT. */
  page(
    walletId: string,
    cursor: LedgerCursor | undefined,
    limit: number,
  ): Promise<WalletLedgerEntry[]> {
    const after = cursor
      ? {
          $or: [
            { createdAt: { $gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { $gt: cursor.id } },
          ],
        }
      : {};

    return this.em.find(WalletLedgerEntry, { walletId, ...after } as never, {
      orderBy: { createdAt: 'asc', id: 'asc' } as never,
      limit: limit + 1,
      disableIdentityMap: true,
    });
  }

  /** Todos os lançamentos na ordem de reconstrução do saldo (reconciliação). */
  all(walletId: string): Promise<WalletLedgerEntry[]> {
    return this.em.find(WalletLedgerEntry, { walletId } as never, {
      orderBy: { createdAt: 'asc', id: 'asc' } as never,
      disableIdentityMap: true,
    });
  }
}
