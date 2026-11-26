import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  SWAGGER_ENABLED: z.stringbool().default(true),
  OTEL_ENABLED: z.stringbool().default(false),
  OTEL_SERVICE_NAME: z.string().min(1).default('wagering-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default('http://localhost:4318'),
  OPTIMISTIC_LOCK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  // Só no emulador (MiniStack); na AWS o SDK resolve o endpoint pela região.
  SQS_ENDPOINT: z.url().optional(),
  SQS_WAGER_TRANSACTIONS_QUEUE: z.string().endsWith('.fifo').default('wager-transactions.fifo'),
  SQS_WAGER_TRANSACTIONS_DLQ: z.string().endsWith('.fifo').default('wager-transactions-dlq.fifo'),
  SQS_WAIT_TIME_SECONDS: z.coerce.number().int().min(0).max(20).default(20),
  SQS_MAX_MESSAGES: z.coerce.number().int().min(1).max(10).default(10),
  SQS_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/worker-heartbeat'),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof EnvSchema>;

/** Valida as variáveis de ambiente na inicialização; falha cedo se faltar algo. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
