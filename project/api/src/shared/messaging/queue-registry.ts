import { Logger } from '@nestjs/common';
import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';

export interface QueueCheck {
  ok: boolean;
  queue?: string;
  error?: unknown;
}

/** Resolve nome → URL das filas sob demanda e guarda em cache; a fila é criada pela infraestrutura. */
export class QueueRegistry {
  private readonly logger = new Logger(QueueRegistry.name);
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly sqs: SQSClient,
    private readonly names: readonly string[],
  ) {}

  async url(name: string): Promise<string> {
    const cached = this.urls.get(name);

    if (cached) {
      return cached;
    }

    const output = await this.sqs.send(new GetQueueUrlCommand({ QueueName: name }));

    if (!output.QueueUrl) {
      this.logger.error({ message: 'Queue URL missing in response', queue: name });
      throw new Error(`Queue ${name} has no URL`);
    }

    this.urls.set(name, output.QueueUrl);
    return output.QueueUrl;
  }

  /** Uma chamada real por fila: o readiness não pode confiar só no cache de URLs. */
  async checkConnection(): Promise<QueueCheck> {
    for (const name of this.names) {
      try {
        await this.sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: await this.url(name),
            AttributeNames: ['ApproximateNumberOfMessages'],
          }),
        );
      } catch (error) {
        return { ok: false, queue: name, error };
      }
    }

    return { ok: true };
  }
}
