import {
  context,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Histogram,
} from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_BAGGAGE_KEY = 'correlation.id';

const tracer = trace.getTracer('wagering-api.http');
let requestDuration: Histogram | undefined;

// A API de métricas não tem proxy: o instrumento só pode ser criado depois de startTelemetry().
function getRequestDuration(): Histogram {
  requestDuration ??= metrics
    .getMeter('wagering-api.http')
    .createHistogram('http.server.request.duration', {
      description: 'Duração das requisições HTTP',
      unit: 's',
      advice: {
        explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      },
    });
  return requestDuration;
}

/** Span SERVER, contexto W3C, baggage com o correlationId e histograma de latência por rota. */
export function httpTelemetry(request: Request, response: Response, next: NextFunction): void {
  const correlationId = ensureCorrelationId(request, response);
  const parent = withCorrelationId(
    propagation.extract(context.active(), request.headers),
    correlationId,
  );
  const span = tracer.startSpan(
    request.method,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': request.method,
        'url.path': request.path,
        'correlation.id': correlationId,
      },
    },
    parent,
  );
  const startedAt = performance.now();
  let ended = false;

  const end = (): void => {
    if (ended) {
      return;
    }

    ended = true;
    const route = resolveRoute(request);
    const statusCode = response.statusCode;

    span.updateName(`${request.method} ${route}`);
    span.setAttributes({ 'http.route': route, 'http.response.status_code': statusCode });

    if (statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }

    span.end();
    getRequestDuration().record((performance.now() - startedAt) / 1000, {
      'http.request.method': request.method,
      'http.route': route,
      'http.response.status_code': statusCode,
    });
  };

  response.on('finish', end);
  response.on('close', end);
  context.with(trace.setSpan(parent, span), next);
}

// Atrás do nginx o header já vem; o ALB não gera X-Request-Id, então a api cria um quando falta.
function ensureCorrelationId(request: Request, response: Response): string {
  const correlationId = request.header('x-request-id') || randomUUID();
  request.headers['x-request-id'] = correlationId;
  response.setHeader('X-Request-Id', correlationId);
  return correlationId;
}

/** Coloca o correlationId no baggage; também usado pelo consumer SQS. */
export function withCorrelationId(parent: Context, correlationId: string | undefined): Context {
  if (!correlationId) {
    return parent;
  }

  const baggage = propagation.getBaggage(parent) ?? propagation.createBaggage();
  return propagation.setBaggage(
    parent,
    baggage.setEntry(CORRELATION_ID_BAGGAGE_KEY, { value: correlationId }),
  );
}

// Rota do template (/wallets/:walletId), nunca o path concreto: evita cardinalidade alta nas métricas.
function resolveRoute(request: Request): string {
  const routePath: unknown = request.route?.path;

  if (typeof routePath !== 'string') {
    return 'unmatched';
  }

  return `${request.baseUrl}${routePath}`;
}
