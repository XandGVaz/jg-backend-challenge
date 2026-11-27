import { Module } from '@nestjs/common';
import { loadEnv } from '../../config/env.js';
import { SqsModule } from '../../shared/messaging/sqs.module.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import {
  DEFAULT_OUTBOX_BATCH_SIZE,
  OUTBOX_PUBLISHER_OPTIONS,
  OutboxService,
  type OutboxPublisherOptions,
} from './services/outbox.service.js';

/** Grava eventos na transação do caso de uso e publica as pendentes em `wallet-events.fifo`. */
@Module({
  imports: [SqsModule],
  providers: [
    OutboxRepository,
    OutboxService,
    {
      provide: OUTBOX_PUBLISHER_OPTIONS,
      useFactory: (): OutboxPublisherOptions => {
        const env = loadEnv();
        return {
          queueName: env.SQS_WALLET_EVENTS_QUEUE,
          batchSize: DEFAULT_OUTBOX_BATCH_SIZE,
          maxAttempts: env.OPTIMISTIC_LOCK_MAX_ATTEMPTS,
        };
      },
    },
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
