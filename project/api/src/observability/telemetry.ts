import { hostname } from 'node:os';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import pkg from '../../package.json' with { type: 'json' };
import type { Env } from '../config/env.js';

type TelemetryEnv = Pick<
  Env,
  'NODE_ENV' | 'OTEL_ENABLED' | 'OTEL_SERVICE_NAME' | 'OTEL_EXPORTER_OTLP_ENDPOINT'
>;

let sdk: NodeSDK | undefined;

/*
    Sem auto-instrumentação: no Bun os hooks de require/import do OTel não interceptam
    http, express, nest nem pg. Spans e métricas são criados explicitamente (http-telemetry.middleware.ts).
*/
export function startTelemetry(env: TelemetryEnv): void {
  if (!env.OTEL_ENABLED) {
    return;
  }

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '');

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: pkg.version,
      'service.instance.id': hostname(),
      'deployment.environment.name': env.NODE_ENV,
    }),
    resourceDetectors: [],
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 10_000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
      }),
    ],
    instrumentations: [],
  });
  sdk.start();
}

/** Exporta o que estiver em buffer antes de o processo sair. */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }

  await sdk.shutdown();
  sdk = undefined;
}
