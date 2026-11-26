import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { loadEnv, type Env } from '../../config/env.js';
import { QueueRegistry } from './queue-registry.js';

/** Credenciais pela cadeia padrão do SDK: variáveis no emulador, IAM role da task na AWS. */
export function createSqsClient(env: Pick<Env, 'AWS_REGION' | 'SQS_ENDPOINT'>): SQSClient {
  return new SQSClient({
    region: env.AWS_REGION,
    // O emulador devolve QueueUrl com o host visto pelo cliente; o endpoint configurado vale mais.
    ...(env.SQS_ENDPOINT && { endpoint: env.SQS_ENDPOINT, useQueueUrlAsEndpoint: false }),
  });
}

/** Cliente SQS e registro de filas, compartilhados pela api (readiness) e pelo worker (consumer). */
@Module({
  providers: [
    { provide: SQSClient, useFactory: () => createSqsClient(loadEnv()) },
    {
      provide: QueueRegistry,
      inject: [SQSClient],
      useFactory: (sqs: SQSClient) => {
        const env = loadEnv();
        return new QueueRegistry(sqs, [
          env.SQS_WAGER_TRANSACTIONS_QUEUE,
          env.SQS_WAGER_TRANSACTIONS_DLQ,
        ]);
      },
    },
  ],
  exports: [SQSClient, QueueRegistry],
})
export class SqsModule implements OnApplicationShutdown {
  constructor(private readonly sqs: SQSClient) {}

  // Depois do beforeApplicationShutdown: os pollers já pararam quando o cliente é fechado.
  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}
