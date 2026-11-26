import { rm, writeFile } from 'node:fs/promises';
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { HealthService } from '../modules/health/services/health.service.js';

/*
    O worker não tem HTTP: o healthcheck do container lê a data deste arquivo.
    Só é atualizado quando PostgreSQL e SQS respondem, então arquivo velho = worker não pronto.
*/
@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private readonly env = loadEnv();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly health: HealthService) {}

  onApplicationBootstrap(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), this.env.WORKER_HEARTBEAT_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await rm(this.env.WORKER_HEARTBEAT_FILE, { force: true });
  }

  private async beat(): Promise<void> {
    try {
      await this.health.checkReadiness();
      await writeFile(this.env.WORKER_HEARTBEAT_FILE, new Date().toISOString());
    } catch (error) {
      this.logger.warn({
        message: 'Worker heartbeat skipped',
        errorName: error instanceof Error ? error.name : 'Error',
      });
    }
  }
}
