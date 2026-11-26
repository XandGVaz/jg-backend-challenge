# otel-collector — OpenTelemetry Collector

Recebe traces, métricas e logs da api por OTLP e distribui para os backends. A api só conhece o collector: trocar Jaeger, Prometheus ou Loki não muda o código.

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `observability/otel-collector/Dockerfile` (`FROM otel/opentelemetry-collector-contrib:0.166.0`) |
| Config | `observability/otel-collector/config.yaml`, copiado para `/etc/otelcol/config.yaml` |
| Porta no host | `${OTLP_HTTP_PORT:-4318}` → `4318` (OTLP HTTP) |
| Portas internas | `4317` OTLP gRPC, `8889` métricas para o Prometheus, `13133` health check |
| Depende de | `jaeger`, `loki` |

## 2. Pipelines

```
api (OTLP/HTTP :4318) ──> otel-collector ──┬─> Jaeger      (traces, OTLP gRPC)
                                           ├─> Prometheus  (métricas, scrape :8889)
                                           └─> Loki        (logs, OTLP HTTP /otlp)
                                                   └──────── Grafana (datasources uid: prometheus, loki, jaeger)
```

| Sinal | Receiver | Processors | Exporter | Destino |
| --- | --- | --- | --- | --- |
| traces | `otlp` | `memory_limiter`, `batch` | `otlp_grpc/jaeger` | `jaeger:4317` |
| metrics | `otlp` | `memory_limiter`, `batch` | `prometheus` | expõe `:8889`, lido pelo [Prometheus](prometheus.md) |
| logs | `otlp` | `memory_limiter`, `batch` | `otlp_http/loki` | `http://loki:3100/otlp` |

`memory_limiter` vem primeiro: sob pressão, o collector recusa dados em vez de cair por falta de memória.

## 3. Identidade do serviço (resource)

Definido em `api/src/observability/telemetry.ts`. Não repita esses valores em atributos de sinal.

| Atributo | Valor | No Prometheus | No Loki |
| --- | --- | --- | --- |
| `service.name` | `OTEL_SERVICE_NAME` (`wagering-api`) | label `job` | label `service_name` |
| `service.instance.id` | hostname do container (uma réplica) | label `instance` | metadado |
| `service.version` | versão do `package.json` | `target_info` | metadado |
| `deployment.environment.name` | `NODE_ENV` | `target_info` | metadado |

Um processo separado (ex.: worker dedicado) usa o **mesmo** `service.name` e se distingue pelo atributo `wagering.role` (`http`, `consumer`, `outbox-publisher`, `scheduler`) nas métricas que fazem sentido por papel.

## 4. Tradução OTel → Prometheus

Feita pelo exporter `prometheus`:

| OTel | Prometheus |
| --- | --- |
| pontos no nome e nos atributos (`wagering.transaction.kind`) | `_` (`wagering_transaction_kind`) |
| unidade `s` | sufixo `_seconds` |
| unidades `{…}` (`{transaction}`) | descartadas |
| Counter | sufixo `_total` |
| Histogram | `_bucket`, `_sum`, `_count` |
| `service.name` / `service.instance.id` | `job` / `instance` (com `honor_labels: true` no scrape) |

Exemplo: `http.server.request.duration` (unidade `s`) → `http_server_request_duration_seconds_bucket`.

## 5. Operação

```bash
docker compose logs otel-collector
curl -s localhost:4318/v1/traces -X POST -H 'Content-Type: application/json' -d '{}'   # OTLP HTTP responde
docker compose exec prometheus wget -qO- http://otel-collector:8889/metrics | head    # métricas convertidas
```

Para testar a api fora do Compose enviando telemetria a este collector: `OTEL_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

Não transforme IDs de domínio (`walletId`, `transactionId`) em labels nem em atributos de resource.
