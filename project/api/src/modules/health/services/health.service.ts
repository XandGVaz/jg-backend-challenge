import { Injectable, Logger } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import { DependencyUnavailableError } from '../../../shared/errors/index.js';
import { QueueRegistry } from '../../../shared/messaging/queue-registry.js';
import type { Readiness } from '../health.schema.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly orm: MikroORM,
    private readonly queues: QueueRegistry,
  ) {}

  async checkReadiness(): Promise<Readiness> {
    const database = await this.orm.checkConnection();

    if (!database.ok) {
      this.logger.warn(`Readiness failed: database unreachable reason=${database.reason}`);
      throw new DependencyUnavailableError('database', { cause: database.error });
    }

    const queue = await this.queues.checkConnection();

    if (!queue.ok) {
      this.logger.warn({ message: 'Readiness failed: queue unreachable', queue: queue.queue });
      throw new DependencyUnavailableError('queue', { cause: queue.error });
    }

    return { status: 'ok', checks: { database: 'up', queue: 'up' } };
  }
}
