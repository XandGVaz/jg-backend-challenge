import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { Money } from '../../../shared/domain/money.js';
import { WalletLedgerRepository } from '../repositories/wallet-ledger.repository.js';
import { recordReconciliation } from '../wallets.metrics.js';
import type { ReconciliationReport } from '../wallets.schema.js';
import { WalletsService } from './wallets.service.js';

const tracer = trace.getTracer('wagering-api.wallets');

/** Saldo materializado contra o saldo reconstruído pelo ledger (invariante final dos testes, §13). */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly wallets: WalletsService,
    private readonly ledger: WalletLedgerRepository,
  ) {}

  reconcile(walletId: string): Promise<ReconciliationReport> {
    return tracer.startActiveSpan('wallet.reconcile', async (span) => {
      try {
        const report = await this.compute(walletId);
        span.setAttributes({
          'wagering.wallet_id': walletId,
          'wagering.reconciliation.consistent': report.consistent,
          'wagering.reconciliation.checked_entries': report.checkedEntries,
        });

        if (!report.consistent) {
          span.addEvent('reconciliation.divergence');
          this.logger.error({ message: 'Reconciliation divergence', walletId });
        }

        recordReconciliation(report.consistent);
        return report;
      } finally {
        span.end();
      }
    });
  }

  private async compute(walletId: string): Promise<ReconciliationReport> {
    const wallet = await this.wallets.get(walletId);
    const entries = await this.ledger.all(walletId);
    const calculated = entries.reduce(
      (sum, entry) => sum.add(entry.signedMoney()),
      Money.zero(wallet.currency),
    );
    const difference = wallet.balance.subtract(calculated);

    return {
      walletId,
      storedBalance: wallet.balance.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent: difference.isZero(),
      checkedEntries: entries.length,
      checkedAt: new Date().toISOString(),
    };
  }
}
