import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseSchema } from './error-response.schema.js';

const DESCRIPTION_BY_STATUS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Payload inválido (REQUEST_VALIDATION_FAILED)',
  [HttpStatus.NOT_FOUND]: 'Recurso não encontrado',
  [HttpStatus.CONFLICT]: 'Conflito (idempotência ou unicidade)',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Rejeição por regra de negócio',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Falha transitória de infraestrutura; pode reenviar',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Erro inesperado',
};

/** Documenta no Swagger as respostas de erro que a rota pode emitir, todas com ErrorResponse. */
export function ApiErrorResponses(...statuses: HttpStatus[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTION_BY_STATUS[status] ?? HttpStatus[status],
        standardSchema: ErrorResponseSchema,
      }),
    ),
  );
}
