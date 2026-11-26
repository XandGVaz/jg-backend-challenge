import type { z } from 'zod';
import { RequestValidationError } from '../errors/index.js';

/** Valida fora do pipe HTTP (headers, mensagens SQS) com o mesmo erro da validação HTTP. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw RequestValidationError.fromIssues(result.error.issues);
  }

  return result.data;
}
