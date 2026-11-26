# prometheus — métricas

Coleta e guarda as métricas que o [otel-collector](otel-collector.md) expõe em `:8889`. É o datasource padrão do [Grafana](grafana.md). As seções 4 a 8 são a **referência das métricas** da aplicação.

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `observability/prometheus/Dockerfile` (`FROM prom/prometheus:v3.16.0`) |
| Config | `observability/prometheus/prometheus.yml`, copiado para `/etc/prometheus/prometheus.yml` |
| Porta no host | `${PROMETHEUS_PORT:-9090}` → `9090` |
| Volume | `prometheus-data` → `/prometheus` |
| Retenção | 7 dias (`--storage.tsdb.retention.time=7d`, no `CMD` do Dockerfile) |

## 2. Scrape

| Job | Alvo | Observação |
| --- | --- | --- |
| `otel-collector` | `otel-collector:8889` | `honor_labels: true`: mantém `job=wagering-api` e `instance=<hostname da réplica>` vindos do OTel |
| `prometheus` | `localhost:9090` | métricas do próprio Prometheus |

Intervalo de scrape e avaliação: 10 s, igual ao export periódico da api (`exportIntervalMillis: 10_000`). Por isso o Grafana usa `timeInterval: 10s`.

## 3. Operação

- UI: <http://localhost:9090>. Status → Targets mostra se o collector está sendo lido.
- Uma réplica que parou de exportar some das séries depois de ~5 min (staleness).

```promql
sum by (instance) (rate(http_server_request_duration_seconds_count{job="wagering-api"}[1m]))   # req/s por réplica
histogram_quantile(0.99, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{job="wagering-api"}[5m])))
count(count by (instance) (http_server_request_duration_seconds_count{job="wagering-api"}))    # réplicas reportando
```

## 4. Convenções de nome

- Nome OTel em minúsculas separado por ponto, prefixo `wagering.` para negócio. HTTP segue a semconv (`http.server.request.duration`).
- Unidade no campo `unit` (UCUM), nunca no nome: `s`, `{transaction}`, `{message}`, `{event}`, `{conflict}`, `{retry}`, `{request}`, `{run}`.
- Counter não termina em `.total` nem `.count`.
- Meter por módulo: `wagering-api.wagering`, `wagering-api.messaging`, `wagering-api.outbox`, `wagering-api.wallets`, `wagering-api.http`.
- O nome no Prometheus segue a tradução de [otel-collector.md](otel-collector.md), seção 4.

## 5. Atributos

Só conjuntos **fechados e pequenos** de valores. Proibidos: `walletId`, `transactionId`, `playerId`, `providerId` (conjunto aberto), `messageId`, `roundId`, `gameId`, path concreto, mensagem de erro, valor monetário.

| Nome curto | Chave do atributo | Prometheus | Valores |
| --- | --- | --- | --- |
| `channel` | `wagering.channel` | `wagering_channel` | `http`, `sqs`, `scheduler` |
| `kind` | `wagering.transaction.kind` | `wagering_transaction_kind` | literais de `WagerTransactionKind` |
| `status` | `wagering.transaction.status` | `wagering_transaction_status` | literais de `WagerTransactionStatus` |
| `failure_code` | `wagering.failure_code` | `wagering_failure_code` | literais de `FailureCode` ([api.md](api.md), seção 10) |
| `outcome` | `wagering.outcome` | `wagering_outcome` | definidos por métrica |
| `reason` | `wagering.reason` | `wagering_reason` | definidos por métrica |
| `operation` | `wagering.operation` | `wagering_operation` | `optimistic_lock`, `sqs_message`, `outbox_publish`, `pending_reference` |
| `use_case` | `wagering.use_case` | `wagering_use_case` | `submit_transaction`, `open_wallet`, `reprocess_pending` |
| `consumer` | `wagering.consumer` | `wagering_consumer` | nome do consumer da inbox |
| `queue` | `messaging.destination.name` | `messaging_destination_name` | nome da fila |
| `event_type` | `wagering.event.type` | `wagering_event_type` | `eventType` dos eventos |
| `consistent` | `wagering.reconciliation.consistent` | `wagering_reconciliation_consistent` | `true`, `false` |

## 6. Catálogo

| Métrica OTel | Tipo | Unidade | Atributos | Prometheus | Requisito (seção 12) |
| --- | --- | --- | --- | --- | --- |
| `http.server.request.duration` | Histogram | `s` | `http.request.method`, `http.route`, `http.response.status_code` | `http_server_request_duration_seconds_*` | latência HTTP (já existe) |
| `wagering.transactions` | Counter | `{transaction}` | `channel`, `kind`, `status`, `failure_code`? | `wagering_transactions_total` | transações por status |
| `wagering.transaction.processing.duration` | Histogram | `s` | `channel`, `kind`, `status` | `wagering_transaction_processing_duration_seconds_*` | latência de processamento |
| `wagering.idempotency.duplicates` | Counter | `{request}` | `channel`, `outcome` = `replay` \| `conflict` | `wagering_idempotency_duplicates_total` | duplicatas detectadas |
| `wagering.inbox.duplicates` | Counter | `{message}` | `consumer` | `wagering_inbox_duplicates_total` | duplicatas detectadas (SQS) |
| `wagering.lock.conflicts` | Counter | `{conflict}` | `use_case` | `wagering_lock_conflicts_total` | conflitos de lock |
| `wagering.retries` | Counter | `{retry}` | `operation` | `wagering_retries_total` | retries |
| `wagering.sqs.messages` | Counter | `{message}` | `queue`, `outcome` = `ack` \| `retry` \| `dlq`; `reason` = `invalid_message` \| `retries_exhausted` só em `dlq` | `wagering_sqs_messages_total` | mensagens em DLQ |
| `wagering.sqs.queue.depth` | ObservableGauge | `{message}` | `queue` (incluindo a DLQ) | `wagering_sqs_queue_depth` | mensagens em DLQ |
| `wagering.outbox.pending` | ObservableGauge | `{event}` | — | `wagering_outbox_pending` | outbox lag |
| `wagering.outbox.lag` | ObservableGauge | `s` | — | `wagering_outbox_lag_seconds` | outbox lag |
| `wagering.outbox.published` | Counter | `{event}` | `event_type`, `outcome` = `published` \| `retry_scheduled` | `wagering_outbox_published_total` | outbox |
| `wagering.outbox.publish.delay` | Histogram | `s` | `event_type` | `wagering_outbox_publish_delay_seconds_*` | outbox lag (commit → publish) |
| `wagering.pending_reference.reprocessed` | Counter | `{transaction}` | `outcome` = `processed` \| `still_pending` \| `expired` | `wagering_pending_reference_reprocessed_total` | referências fora de ordem |
| `wagering.reconciliation.runs` | Counter | `{run}` | `consistent` | `wagering_reconciliation_runs_total` | divergência contabilizada |

## 7. Regras de emissão

- `wagering.transactions` conta **cada estado alcançado** (`PROCESSED`, `REJECTED`, `PENDING_REFERENCE`, `FAILED`), **depois do commit**. Uma transação que passa por `PENDING_REFERENCE` e vira `PROCESSED` aparece nas duas séries; para volume de entrada, filtre os estados terminais. Replay não conta aqui, conta em `wagering.idempotency.duplicates`. `failure_code` só com `status` `REJECTED` ou `FAILED`.
- `wagering.transaction.processing.duration` mede o caso de uso inteiro (inclusive retries de lock), do início do service até o commit.
- `wagering.lock.conflicts` conta cada `OptimisticLockError`. `wagering.retries{operation="optimistic_lock"}` conta cada nova tentativa. Retry esgotado vira `503 CONCURRENCY_CONFLICT`.
- `wagering.sqs.messages{outcome="dlq"}` é incrementado pelo consumer ao mandar para a DLQ ([api.md](api.md), seção 12.1). `wagering.sqs.queue.depth` é o `ApproximateNumberOfMessages` de cada fila.
- **Gauges derivados do banco ou da fila** (`outbox.pending`, `outbox.lag`, `sqs.queue.depth`) mostram o mesmo valor em todas as réplicas. Consulta barata (`SELECT count(*), min(occurred_at) FROM outbox_messages WHERE published_at IS NULL`, com índice parcial). No dashboard, `max`, nunca `sum`.
- `outbox.lag` = `now - min(occurred_at)` das pendentes. Sem pendentes, `0`.
- Divergência de reconciliação também é logada em `error` ([loki.md](loki.md), seção 6).

## 8. Buckets de histograma

`advice.explicitBucketBoundaries` em todo histograma:

| Uso | Buckets (s) |
| --- | --- |
| Latência HTTP e de processamento | `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` |
| Atraso da outbox | `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]` |
