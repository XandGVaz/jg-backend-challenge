import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EntityManager, RequestContext } from '@mikro-orm/postgresql';
import { trace } from '@opentelemetry/api';
import { FailureCode } from '../shared/domain/failure-code.js';
import { WagerTransactionStatus } from '../modules/transactions/domain/wager-transaction-status.js';
import { TransactionsService } from '../modules/transactions/services/transactions.service.js';
import { SubmitTransactionService } from '../modules/wagering/services/submit-transaction.service.js';
import { PeriodicTask } from './periodic-task.js';
import { recordReprocessed, type ReprocessOutcome } from './worker.metrics.js';

const tracer = trace.getTracer('wagering-api.wagering');
const INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;

/**
 * Agendador de PENDING_REFERENCE (REQUISITOS §7.1): pega as vencidas com SKIP LOCKED e retoma cada
 * uma na própria transação; o FOR UPDATE do resume impede que dois workers processem a mesma.
 */
@Injectable()
export class PendingReferenceScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceScheduler.name);
  private readonly task = new PeriodicTask(PendingReferenceScheduler.name, INTERVAL_MS, () =>
    RequestContext.create(this.em, () => this.cycle()),
  );

  constructor(
    private readonly em: EntityManager,
    private readonly transactions: TransactionsService,
    private readonly submit: SubmitTransactionService,
  ) {}

  onApplicationBootstrap(): void {
    this.task.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.task.stop();
  }

  private cycle(): Promise<void> {
    return tracer.startActiveSpan('pending_reference.reprocess', { root: true }, async (span) => {
      try {
        // A reserva com SKIP LOCKED exige transação; cada resume trava a linha de novo com FOR UPDATE.
        const due = await this.em.transactional(() =>
          this.transactions.claimDuePendingReferences(new Date(), BATCH_SIZE),
        );
        span.setAttribute('wagering.batch_size', due.length);

        for (const transaction of due) {
          const outcome = await this.resume(transaction.id);
          recordReprocessed(outcome);
        }
      } finally {
        span.end();
      }
    });
  }

  private async resume(transactionId: string): Promise<ReprocessOutcome> {
    const status = await this.submit.resume(transactionId);

    if (status === WagerTransactionStatus.Processed) {
      return 'processed';
    }

    if (status === WagerTransactionStatus.PendingReference) {
      return 'still_pending';
    }

    const transaction = await this.transactions.findById(transactionId);
    const expired = transaction?.failureCode === FailureCode.ReferenceNotFound;
    this.logger.log({ message: 'Pending reference finished', transactionId, status, expired });
    return expired ? 'expired' : 'rejected';
  }
}
