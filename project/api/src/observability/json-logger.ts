import type { LoggerService, LogLevel } from '@nestjs/common';
import { context, logs, propagation, SeverityNumber, trace } from '@opentelemetry/api';
import { CORRELATION_ID_BAGGAGE_KEY } from './http-telemetry.middleware.js';

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  verbose: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  log: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

type FieldValue = string | number | boolean;
type LogFields = Record<string, FieldValue | undefined>;

/**
 * Logger estruturado: uma linha JSON por evento no stdout e o mesmo registro enviado ao OTel (Loki).
 * Campos de domínio (walletId, transactionId, messageId, providerId) vão como objeto na mensagem:
 * `this.logger.log({ message: 'Bet processed', walletId, transactionId })`.
 */
export class JsonLogger implements LoggerService {
  private readonly otel = logs.getLogger('wagering-api');

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    const { scope, stack } = splitParams(params);
    const active = context.active();
    const spanContext = trace.getSpan(active)?.spanContext();
    const fields: LogFields = {
      ...toFields(message),
      context: scope,
      correlationId: propagation.getBaggage(active)?.getEntry(CORRELATION_ID_BAGGAGE_KEY)?.value,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      stack,
    };

    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields })}\n`,
    );

    const { message: body, ...attributes } = fields;
    this.otel.emit({
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: body ?? '',
      attributes: withoutUndefined(attributes),
      context: active,
    });
  }
}

// Mesma convenção do ConsoleLogger do Nest: último string é o contexto; num erro, o anterior é o stack.
function splitParams(params: unknown[]): { scope?: string; stack?: string } {
  const strings = params.filter((param): param is string => typeof param === 'string');

  if (strings.length === 0) {
    return {};
  }

  if (strings.length === 1) {
    return { scope: strings[0] };
  }

  return { stack: strings[0], scope: strings[strings.length - 1] };
}

function toFields(message: unknown): LogFields {
  if (message instanceof Error) {
    return { message: message.message, stack: message.stack };
  }

  if (typeof message === 'object' && message !== null) {
    return Object.fromEntries(
      Object.entries(message).map(([key, value]) => [key, toAttribute(value)]),
    );
  }

  return { message: String(message) };
}

function toAttribute(value: unknown): FieldValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return JSON.stringify(value);
}

function withoutUndefined(fields: LogFields): Record<string, FieldValue> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, FieldValue] => entry[1] !== undefined),
  );
}
