import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { HealthModule } from '../modules/health/health.module.js';
import { OutboxModule } from '../modules/outbox/outbox.module.js';
import { TransactionsModule } from '../modules/transactions/transactions.module.js';
import { WagerTransactionsConsumer } from '../modules/wagering/messaging/wager-transactions.consumer.js';
import { WageringModule } from '../modules/wagering/wagering.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { SqsModule } from '../shared/messaging/sqs.module.js';
import { OutboxPublisherLoop } from './outbox-publisher.loop.js';
import { PendingReferenceScheduler } from './pending-reference.scheduler.js';
import { WorkerHeartbeatService } from './worker-heartbeat.service.js';

/** Processo sem HTTP: consumer SQS, publisher da outbox e reprocessamento de PENDING_REFERENCE. */
@Module({
  imports: [
    ObservabilityModule,
    DatabaseModule,
    AuthModule,
    SqsModule,
    HealthModule,
    WageringModule,
    TransactionsModule,
    OutboxModule,
  ],
  providers: [
    WorkerHeartbeatService,
    WagerTransactionsConsumer,
    PendingReferenceScheduler,
    OutboxPublisherLoop,
  ],
})
export class WorkerModule {}
