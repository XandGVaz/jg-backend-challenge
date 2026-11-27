import {
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { EntityManager, RequestContext } from '@mikro-orm/postgresql';
import { loadEnv } from '../../../config/env.js';
import { QueueRegistry } from '../../../shared/messaging/queue-registry.js';
import { SqsPoller } from '../../../shared/messaging/sqs-poller.js';
import { SubmitTransactionService } from '../services/submit-transaction.service.js';
import { WagerTransactionsHandler } from './wager-transactions.handler.js';

/** Liga o handler ao SqsPoller no worker; cada mensagem ganha um EntityManager próprio. */
@Injectable()
export class WagerTransactionsConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private poller: SqsPoller | undefined;

  constructor(
    private readonly sqs: SQSClient,
    private readonly queues: QueueRegistry,
    private readonly em: EntityManager,
    private readonly submit: SubmitTransactionService,
  ) {}

  onApplicationBootstrap(): void {
    const env = loadEnv();
    const handler = new WagerTransactionsHandler(this.submit, env.SQS_MAX_ATTEMPTS);
    this.poller = new SqsPoller(this.sqs, this.queues, {
      queueName: env.SQS_WAGER_TRANSACTIONS_QUEUE,
      deadLetterQueueName: env.SQS_WAGER_TRANSACTIONS_DLQ,
      waitTimeSeconds: env.SQS_WAIT_TIME_SECONDS,
      maxMessages: env.SQS_MAX_MESSAGES,
      handler: (message) => RequestContext.create(this.em, () => handler.handle(message)),
    });
    this.poller.start();
  }

  // Termina as mensagens em andamento e devolve as outras antes de o cliente SQS fechar.
  async beforeApplicationShutdown(): Promise<void> {
    await this.poller?.stop();
  }
}
