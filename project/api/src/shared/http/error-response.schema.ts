import { z } from 'zod';

export const ErrorDetailSchema = z
  .object({
    path: z.string().meta({ example: 'money.amount' }),
    message: z.string().meta({ example: 'Invalid decimal string' }),
  })
  .meta({ id: 'ErrorDetail' });

/** Corpo de toda resposta de erro da API, emitido apenas pelo ErrorHandler. */
export const ErrorResponseSchema = z
  .object({
    statusCode: z.number().int().meta({ example: 400 }),
    code: z.string().meta({ example: 'REQUEST_VALIDATION_FAILED' }),
    message: z.string().meta({ example: 'Request payload is invalid' }),
    details: z.array(ErrorDetailSchema),
    correlationId: z.string().optional(),
    path: z.string().meta({ example: '/wagering/transactions' }),
    timestamp: z.iso.datetime(),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
