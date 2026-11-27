import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../../../shared/domain/integration-event.js';
import type { MoneyProps } from '../../../../shared/domain/money.js';
import type { LedgerDirection } from '../../../transactions/domain/ledger-direction.js';
import type { WalletLedgerEntry } from '../wallet-ledger-entry.js';

export interface WalletBalanceChangedData extends Record<string, unknown> {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/** Só quando há lançamento no ledger, inclusive OPENING (api.md §13.2). */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }

  static from(
    entry: WalletLedgerEntry,
    ctx: { correlationId: string; causationId?: string },
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      aggregateId: entry.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId ?? entry.transactionId,
      occurredAt: entry.createdAt,
      data: {
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: entry.walletVersion,
      },
    });
  }
}
