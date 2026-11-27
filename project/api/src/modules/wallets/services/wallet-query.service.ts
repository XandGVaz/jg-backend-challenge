import { Injectable } from '@nestjs/common';
import { decodeLedgerCursor, encodeLedgerCursor } from '../ledger-cursor.js';
import { WalletLedgerRepository } from '../repositories/wallet-ledger.repository.js';
import { toLedgerEntryView, toWalletView } from '../wallets.mapper.js';
import type { LedgerPage, LedgerPageQuery, WalletView } from '../wallets.schema.js';
import { WalletsService } from './wallets.service.js';

/** GET /wallets/:walletId e o ledger paginado por keyset (api.md §9.2). */
@Injectable()
export class WalletQueryService {
  constructor(
    private readonly wallets: WalletsService,
    private readonly ledger: WalletLedgerRepository,
  ) {}

  async get(walletId: string): Promise<WalletView> {
    return toWalletView(await this.wallets.get(walletId));
  }

  async ledgerPage(walletId: string, query: LedgerPageQuery): Promise<LedgerPage> {
    const cursor = query.cursor === undefined ? undefined : decodeLedgerCursor(query.cursor);
    await this.wallets.get(walletId);

    const rows = await this.ledger.page(walletId, cursor, query.limit);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeLedgerCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return { items: items.map(toLedgerEntryView), nextCursor };
  }
}
