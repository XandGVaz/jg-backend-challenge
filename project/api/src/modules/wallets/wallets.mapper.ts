import type { WalletLedgerEntry } from './domain/wallet-ledger-entry.js';
import type { Wallet } from './domain/wallet.js';
import type { LedgerEntryView, WalletView } from './wallets.schema.js';

export function toWalletView(wallet: Wallet): WalletView {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export function toLedgerEntryView(entry: WalletLedgerEntry): LedgerEntryView {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    direction: entry.direction,
    money: entry.money.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    createdAt: entry.createdAt.toISOString(),
  };
}
