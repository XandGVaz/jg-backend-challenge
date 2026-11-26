import { Logger } from '@nestjs/common';
import { OptimisticLockError, type EntityManager } from '@mikro-orm/postgresql';
import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { AppError, ConcurrencyConflictError, ErrorKind } from '../shared/errors/index.js';
import {
  recordLockConflict,
  recordLockRetry,
  type TransactionUseCase,
} from './database.metrics.js';

const tracer = trace.getTracer('wagering-api.database');
const logger = new Logger('RunTransaction');

export interface RunTransactionOptions {
  useCase: TransactionUseCase;
  /** Total de tentativas, contando a primeira (env OPTIMISTIC_LOCK_MAX_ATTEMPTS). */
  maxAttempts: number;
}

/**
 * Executa o caso de uso numa transação e repete a transação inteira a cada OptimisticLockError.
 * Cada tentativa é um span `db.transaction` (docs/jaeger.md §5). Esgotadas as tentativas, lança
 * ConcurrencyConflictError (503): nada foi gravado e o cliente pode reenviar.
 */
export async function runTransaction<T>(
  em: EntityManager,
  options: RunTransactionOptions,
  work: (em: EntityManager) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runAttempt(em, attempt, work);
    } catch (error) {
      if (!(error instanceof OptimisticLockError)) {
        throw error;
      }

      recordLockConflict(options.useCase);

      if (attempt >= options.maxAttempts) {
        logger.warn({
          message: 'Optimistic lock retries exhausted',
          useCase: options.useCase,
          attempt,
        });
        throw new ConcurrencyConflictError(options.useCase, attempt, { cause: error });
      }

      recordLockRetry();
      logger.debug({
        message: 'Optimistic lock conflict, retrying',
        useCase: options.useCase,
        attempt,
      });
    }
  }
}

function runAttempt<T>(
  em: EntityManager,
  attempt: number,
  work: (em: EntityManager) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    'db.transaction',
    {
      kind: SpanKind.CLIENT,
      attributes: { 'db.system.name': 'postgresql', 'wagering.attempt': attempt },
    },
    async (span) => {
      try {
        return await em.transactional((tx) => work(tx));
      } catch (error) {
        markFailure(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

// Conflito de lock vira evento; rejeição de negócio fica UNSET; só transitório ou inesperado é ERROR.
function markFailure(span: Span, error: unknown): void {
  if (error instanceof OptimisticLockError) {
    span.addEvent('optimistic_lock.conflict');
    return;
  }

  if (error instanceof AppError && error.kind !== ErrorKind.Transient) {
    return;
  }

  const failure = error instanceof Error ? error : new Error(String(error));
  span.recordException(failure);
  span.setStatus({ code: SpanStatusCode.ERROR, message: failure.name });
}
