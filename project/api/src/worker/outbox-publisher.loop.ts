import {
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EntityManager, RequestContext } from '@mikro-orm/postgresql';
import {
  DEFAULT_OUTBOX_BATCH_SIZE,
  OutboxService,
} from '../modules/outbox/services/outbox.service.js';
import { PeriodicTask } from './periodic-task.js';

const INTERVAL_MS = 1_000;
// Teto de lotes por ciclo: drena um backlog sem segurar o shutdown por muito tempo.
const MAX_BATCHES_PER_CYCLE = 20;

/**
 * Publica os eventos pendentes da outbox depois do commit; várias réplicas dividem as linhas (§11).
 * Enquanto o lote volta cheio, publica o próximo no mesmo ciclo: sob carga, esperar 1 s entre
 * lotes deixaria a outbox crescer.
 */
@Injectable()
export class OutboxPublisherLoop implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private stopping = false;
  private readonly task = new PeriodicTask(OutboxPublisherLoop.name, INTERVAL_MS, () =>
    RequestContext.create(this.em, () => this.drain()),
  );

  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
  ) {}

  onApplicationBootstrap(): void {
    this.task.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.task.stop();
  }

  private async drain(): Promise<void> {
    for (let batch = 0; batch < MAX_BATCHES_PER_CYCLE && !this.stopping; batch++) {
      const summary = await this.outbox.publishDue();

      if (summary.claimed < DEFAULT_OUTBOX_BATCH_SIZE) {
        return;
      }
    }
  }
}
