import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { shutdownTelemetry } from './telemetry.js';

/** Garante o flush de spans, métricas e logs pendentes no SIGTERM. */
@Module({})
export class ObservabilityModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}
