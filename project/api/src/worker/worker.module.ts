import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../modules/health/health.module.js';
import { WageringModule } from '../modules/wagering/wagering.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { SqsModule } from '../shared/messaging/sqs.module.js';
import { WorkerHeartbeatService } from './worker-heartbeat.service.js';

/** Processo sem HTTP: consumer SQS, publisher da outbox e reprocessamento de PENDING_REFERENCE. */
@Module({
  imports: [ObservabilityModule, DatabaseModule, SqsModule, HealthModule, WageringModule],
  providers: [WorkerHeartbeatService],
})
export class WorkerModule {}
