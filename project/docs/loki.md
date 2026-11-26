# loki — logs

Guarda os logs estruturados da api, recebidos por OTLP do [otel-collector](otel-collector.md). Consultado pelo [Grafana](grafana.md). As seções 5 e 6 são a **referência dos campos e níveis de log**.

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `observability/loki/Dockerfile` (`FROM grafana/loki:3.7.10`) |
| Config | `observability/loki/config.yaml`, copiado para `/etc/loki/config.yaml` |
| Porta no host | `${LOKI_PORT:-3100}` → `3100` |
| Volume | `loki-data` → `/loki` |
| Retenção | 168 h (7 dias), aplicada pelo compactor |

## 2. Config

- Modo monolítico, sem autenticação (`auth_enabled: false`), ring em memória e armazenamento em filesystem.
- Schema `v13` com índice `tsdb`.
- `allow_structured_metadata: true` é obrigatório para a ingestão OTLP.

## 3. Labels e metadados

- Label indexado: `service_name` (de `service.name`), mais o que o Loki promover do resource.
- Os campos da seção 5 e `trace_id`/`span_id` viram **structured metadata**, consultados com filtro `|`. Nunca configure o collector para transformar `walletId`, `transactionId` ou similar em label: isso explode o índice.
- Nível: `detected_level` (`info`, `warn`, `error`...).
- O datasource Loki do Grafana liga `trace_id` ao Jaeger.

## 4. Operação

```logql
{service_name="wagering-api"} | detected_level=~"warn|error|fatal"
{service_name="wagering-api"} | correlationId="teste-123"
{service_name="wagering-api"} | walletId="0192f291-27dd-7d3f-8071-5f8685deef37"
sum by (detected_level) (count_over_time({service_name="wagering-api"}[5m]))
```

```bash
curl -s localhost:3100/ready
curl -s localhost:3100/loki/api/v1/labels
```

Logs também saem no stdout de cada réplica (`docker compose logs api`). O nginx não envia logs ao Loki.

## 5. Campos de log

Uma linha JSON por evento no stdout e o mesmo registro via OTLP, emitidos pelo `JsonLogger` (`api/src/observability/json-logger.ts`).

| Campo | Origem | Presença |
| --- | --- | --- |
| `timestamp` | ISO-8601 UTC | sempre |
| `level` | `log`, `warn`, `error`, `debug`, `verbose`, `fatal` | sempre |
| `message` | texto curto, fixo por tipo de evento, em inglês, sem IDs interpolados | sempre |
| `context` | nome da classe (`new Logger(X.name)`) | sempre |
| `correlationId`, `traceId`, `spanId` | contexto OTel ativo (automático) | quando houver contexto |
| `messageId`, `transactionId`, `walletId`, `providerId` | objeto passado ao logger | quando a operação os tiver (seção 12 do enunciado) |
| `externalTransactionId`, `kind`, `status`, `failureCode`, `attempt`, `outboxId`, `eventType`, `queue` | objeto passado ao logger | quando relevante |
| `stack` | erro | só em `error`/`fatal` |

```json
{"timestamp":"2026-11-26T15:00:00.000Z","level":"warn","message":"Bet rejected","context":"WageringService","transactionId":"0192f298-…","walletId":"0192f291-…","providerId":"provider-a","failureCode":"INSUFFICIENT_FUNDS","correlationId":"…","traceId":"…","spanId":"…"}
```

**Proibido em log:** body ou payload completo, `money`/saldos, `playerId`, `Idempotency-Key` completa (use `providerId` + `externalTransactionId`), headers, `DATABASE_URL`, segredos, entidades inteiras.

## 6. Níveis

| Nível | Uso |
| --- | --- |
| `debug` | replay idempotente, duplicata de inbox, nada a fazer, ciclo de worker sem trabalho |
| `log` | transação processada, wallet criada, evento publicado, bootstrap |
| `warn` | rejeição de negócio, 4xx, retry de lock, retry de mensagem, referência pendente, wallet inexistente na fila |
| `error` | 5xx, falha inesperada, mensagem enviada para a DLQ (inclusive inválida), **divergência de reconciliação**, outbox esgotando tentativas |
| `fatal` | processo não consegue subir |

Em hot path (consumer, outbox), use `debug` por item e um `log` de resumo por ciclo.
