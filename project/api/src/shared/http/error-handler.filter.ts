import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, ErrorKind, type ErrorDetail } from '../errors/index.js';
import type { ErrorResponse } from './error-response.schema.js';

/** Mapeamento único categoria → status HTTP, consistente entre todos os endpoints. */
const STATUS_BY_KIND: Record<ErrorKind, HttpStatus> = {
  [ErrorKind.Validation]: HttpStatus.BAD_REQUEST,
  [ErrorKind.NotFound]: HttpStatus.NOT_FOUND,
  [ErrorKind.Conflict]: HttpStatus.CONFLICT,
  [ErrorKind.BusinessRule]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorKind.Transient]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorKind.Internal]: HttpStatus.INTERNAL_SERVER_ERROR,
};

interface ResolvedError {
  statusCode: number;
  code: string;
  message: string;
  details: readonly ErrorDetail[];
}

/**
 * Ponto de saída único dos erros da API.
 * Registrado como APP_FILTER: nenhum controller ou serviço monta resposta de erro.
 */
@Catch()
export class ErrorHandler implements ExceptionFilter {
  private readonly logger = new Logger(ErrorHandler.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error(`Unhandled ${host.getType()} exception`, toStack(exception));
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const resolved = resolve(exception);
    const body: ErrorResponse = {
      statusCode: resolved.statusCode,
      code: resolved.code,
      message: resolved.message,
      details: [...resolved.details],
      correlationId: request.header('x-request-id'),
      path: request.path,
      timestamp: new Date().toISOString(),
    };

    this.log(exception, body, request.method);
    response.status(body.statusCode).json(body);
  }

  private log(exception: unknown, body: ErrorResponse, method: string): void {
    const summary = `${method} ${body.path} -> ${body.statusCode} ${body.code} correlationId=${body.correlationId ?? '-'}`;

    if (body.statusCode >= 500) {
      this.logger.error(summary, toStack(exception));
      return;
    }

    this.logger.warn(summary);
  }
}

function resolve(exception: unknown): ResolvedError {
  if (exception instanceof AppError) {
    return {
      statusCode: STATUS_BY_KIND[exception.kind],
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  // Erros do próprio framework: rota inexistente, JSON malformado, payload grande demais.
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    return {
      statusCode,
      code: HttpStatus[statusCode] ?? `HTTP_${statusCode}`,
      message: exception.message,
      details: [],
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    details: [],
  };
}

function toStack(exception: unknown): string | undefined {
  if (exception instanceof Error) {
    return exception.stack;
  }

  return String(exception);
}
