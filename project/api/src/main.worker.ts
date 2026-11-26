import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env.js';
import { JsonLogger } from './observability/json-logger.js';
import { startTelemetry } from './observability/telemetry.js';
import { WorkerModule } from './worker/worker.module.js';

/** Mesmo código e imagem da api, outro entrypoint: só os workers, sem servidor HTTP. */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  startTelemetry(env);

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new JsonLogger(),
  });

  // SIGTERM → beforeApplicationShutdown (pollers param) → onApplicationShutdown (SQS, banco, OTel).
  app.enableShutdownHooks();
  new Logger('Bootstrap').log({
    message: 'Worker started',
    queue: env.SQS_WAGER_TRANSACTIONS_QUEUE,
    telemetry: env.OTEL_ENABLED,
  });
}

await bootstrap();
