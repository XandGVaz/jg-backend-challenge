import { resolve } from 'node:path';

/** Stack do Compose em pé (`docker compose up -d --build --scale api=3 --scale worker=2 --wait`). */
export const E2E = {
  baseUrl: process.env.E2E_BASE_URL ?? '',
  databaseUrl:
    process.env.E2E_DATABASE_URL ?? 'postgres://wagering:wagering@localhost:5433/wagering',
  sqsEndpoint: process.env.E2E_SQS_ENDPOINT ?? 'http://localhost:4566',
  composeFile:
    process.env.E2E_COMPOSE_FILE ?? resolve(import.meta.dirname, '../../../../docker-compose.yml'),
};

/** Sem E2E_BASE_URL a suíte é pulada: ela exige containers reais (REQUISITOS §13). */
export const skipIntegration = !E2E.baseUrl;
