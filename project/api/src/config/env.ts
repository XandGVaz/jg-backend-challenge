import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    // URL inteira (Compose) ou as partes injetadas do Secrets Manager (ECS); uma das duas formas.
    DATABASE_URL: z.url().optional(),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().min(1).optional(),
    DB_USER: z.string().min(1).optional(),
    DB_PASSWORD: z.string().min(1).optional(),
    DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
    DATABASE_SSL_CA_FILE: z.string().min(1).optional(),
    DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(0),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
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
    SQS_WALLET_EVENTS_QUEUE: z.string().endsWith('.fifo').default('wallet-events.fifo'),
    SQS_WAIT_TIME_SECONDS: z.coerce.number().int().min(0).max(20).default(20),
    SQS_MAX_MESSAGES: z.coerce.number().int().min(1).max(10).default(10),
    SQS_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    PENDING_REFERENCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),
    PENDING_REFERENCE_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(1).default(2),
    PENDING_REFERENCE_BACKOFF_MAX_SECONDS: z.coerce.number().int().min(1).default(300),
    WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/worker-heartbeat'),
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_URL) {
      return;
    }

    for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when DATABASE_URL is unset',
        });
      }
    }
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_POOL_MIN > env.DATABASE_POOL_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_POOL_MIN'],
        message: 'Must not exceed DATABASE_POOL_MAX',
      });
    }
  })
  .superRefine((env, ctx) => {
    if (env.PENDING_REFERENCE_BACKOFF_BASE_SECONDS > env.PENDING_REFERENCE_BACKOFF_MAX_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PENDING_REFERENCE_BACKOFF_BASE_SECONDS'],
        message: 'Must not exceed PENDING_REFERENCE_BACKOFF_MAX_SECONDS',
      });
    }
  })
  .transform(({ DATABASE_URL, ...env }) => ({
    ...env,
    DATABASE_URL: DATABASE_URL ?? buildDatabaseUrl(env),
  }));

export type Env = z.infer<typeof EnvSchema>;

// O superRefine garante as partes; a senha do Secrets Manager pode ter caracteres reservados de URL.
function buildDatabaseUrl(env: {
  DB_HOST?: string;
  DB_PORT: number;
  DB_NAME?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
}): string {
  const user = encodeURIComponent(env.DB_USER ?? '');
  const password = encodeURIComponent(env.DB_PASSWORD ?? '');
  const name = encodeURIComponent(env.DB_NAME ?? '');
  return `postgres://${user}:${password}@${env.DB_HOST ?? ''}:${env.DB_PORT}/${name}`;
}

/** Valida as variáveis de ambiente na inicialização; falha cedo se faltar algo. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
