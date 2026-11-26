import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { httpTelemetry } from './observability/http-telemetry.middleware.js';
import { JsonLogger } from './observability/json-logger.js';
import { startTelemetry } from './observability/telemetry.js';
import { setupSwagger, SWAGGER_PATH } from './shared/http/swagger.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  startTelemetry(env);

  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  const logger = new Logger('Bootstrap');

  app.enableShutdownHooks();
  app.use(httpTelemetry);

  if (env.SWAGGER_ENABLED) {
    setupSwagger(app);
    logger.log(`Swagger available at /${SWAGGER_PATH}`);
  } else {
    logger.log('Swagger disabled by SWAGGER_ENABLED=false');
  }

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`API listening on port ${env.PORT} telemetry=${env.OTEL_ENABLED ? 'on' : 'off'}`);
}

await bootstrap();
