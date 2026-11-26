# jaeger — traces

Armazena e mostra os traces distribuídos. Recebe spans do [otel-collector](otel-collector.md) e serve de datasource para o [Grafana](grafana.md). As seções 4 a 6 são a **referência de traces e spans** da aplicação.

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `observability/jaeger/Dockerfile` (`FROM jaegertracing/jaeger:2.20.0`, sem arquivos copiados) |
| Porta no host | `${JAEGER_PORT:-16686}` → `16686` (UI e API de consulta) |
| Porta interna | `4317` OTLP gRPC (recebe do collector) |
| Armazenamento | em memória: os traces somem ao reiniciar o container |

A versão fica em **2.20.0** de propósito: a 2.21+ removeu a API HTTP v1 (`/api/services`, `/api/traces`), que o datasource Jaeger do Grafana 13 ainda usa.

## 2. Uso

- UI: <http://localhost:16686>, serviço `wagering-api`.
- Busque por tag: `correlation.id=<X-Request-Id>`, `wagering.transaction.id=<id>`, `wagering.wallet_id=<id>`, `http.response.status_code=503`.
- Do Grafana: Explore → Jaeger. Cada span tem link para os logs do mesmo trace no Loki (`tracesToLogsV2`).

## 3. Estado atual

Hoje existem o span SERVER de cada requisição HTTP (rotas inexistentes aparecem como `{METHOD} unmatched`) e o CONSUMER `{fila} process` de cada mensagem SQS. Os demais spans da seção 5 entram conforme os casos de uso forem implementados.

## 4. Atributos de negócio

IDs de domínio **vão** em span (alta cardinalidade é aceitável aqui). Nunca em span: payload completo, valor monetário, `playerId`, `Idempotency-Key` inteira, `DATABASE_URL`, credenciais. Para HTTP, mensageria e banco, use a semconv.

| Atributo | Tipo | Exemplo |
| --- | --- | --- |
| `wagering.channel` | string | `http`, `sqs`, `scheduler` |
| `wagering.provider_id` | string | `provider-a` |
| `wagering.wallet_id` | string | UUIDv7 |
| `wagering.transaction.id` | string | UUIDv7 |
| `wagering.transaction.external_id` | string | `transaction-123` |
| `wagering.transaction.kind` | string | `BET` |
| `wagering.transaction.status` | string | `PROCESSED` |
| `wagering.failure_code` | string | `INSUFFICIENT_FUNDS` |
| `wagering.idempotent_replay` | boolean | `true` |
| `wagering.attempt` | int | `2` (tentativa atual de retry) |
| `wagering.outcome`, `wagering.reason` | string | `dlq`, `invalid_message` |
| `wagering.outbox.id` | string | UUIDv7 |
| `wagering.event.type` | string | `WalletBalanceChanged` |
| `correlation.id` | string | valor do `X-Request-Id` |

## 5. Catálogo de spans

| Span | Kind | Tracer | Pai | Atributos | Eventos |
| --- | --- | --- | --- | --- | --- |
| `{METHOD} {http.route}` | SERVER | `wagering-api.http` | `traceparent` do request | `http.request.method`, `url.path`, `http.route`, `http.response.status_code`, `correlation.id` | — |
| `wallet.open` | INTERNAL | `wagering-api.wallets` | span HTTP | `wagering.wallet_id` | — |
| `wallet.reconcile` | INTERNAL | `wagering-api.wallets` | span HTTP | `wagering.wallet_id`, `wagering.reconciliation.consistent`, `wagering.reconciliation.checked_entries` | `reconciliation.divergence` |
| `wager.submit` | INTERNAL | `wagering-api.wagering` | span HTTP ou CONSUMER | `wagering.channel`, `wagering.provider_id`, `wagering.wallet_id`, `wagering.transaction.external_id`, `wagering.transaction.kind`; ao fim `wagering.transaction.id`, `wagering.transaction.status`, `wagering.failure_code`, `wagering.idempotent_replay` | `idempotency.replay`, `idempotency.conflict` |
| `db.transaction` | CLIENT | `wagering-api.database` | `wager.submit`/`wallet.*` | `db.system.name=postgresql`, `wagering.attempt` | `optimistic_lock.conflict` |
| `wager-transactions.fifo process` | CONSUMER | `wagering-api.messaging` | `traceparent` dos `MessageAttributes` | `messaging.system=aws_sqs`, `messaging.destination.name`, `messaging.operation.type=process`, `messaging.message.id`, `wagering.sqs.receive_count`, `wagering.outcome`, `wagering.reason` | `inbox.duplicate` |
| `outbox.poll` | INTERNAL | `wagering-api.outbox` | raiz (um por ciclo) | `wagering.outbox.batch_size` | — |
| `{destino} publish` | PRODUCER | `wagering-api.outbox` | `outbox.poll` + **link** para o contexto gravado na outbox | `messaging.system=aws_sqs`, `messaging.destination.name`, `messaging.operation.type=send`, `wagering.outbox.id`, `wagering.event.type`, `wagering.attempt` | `outbox.retry_scheduled` |
| `pending_reference.reprocess` | INTERNAL | `wagering-api.wagering` | raiz (um por ciclo) | `wagering.batch_size` | — |

- Um `wager.submit` por transação e, dentro dele, um `db.transaction` **por tentativa**: o trace mostra os retries de lock.
- Workers agendados começam trace novo por ciclo e ligam ao request original por **link**, não por pai.
- Status `ERROR` só em falha inesperada ou transitória (5xx, exceção não `AppError`, `TRANSIENT`), com `recordException` e `message: error.name`. Rejeição de negócio, 4xx, replay e duplicata ficam `UNSET`.

## 6. Propagação de contexto

| Trecho | Como |
| --- | --- |
| HTTP | `propagation.extract` de `traceparent`, `tracestate` e `baggage`. O `X-Request-Id` do nginx vira baggage `correlation.id` (`CORRELATION_ID_BAGGAGE_KEY`). Já implementado em `http-telemetry.middleware.ts` |
| SQS (entrada) | o produtor coloca `traceparent`, `tracestate` e `baggage` como `MessageAttributes` String, e o consumer extrai com um getter de `MessageAttributes`. Sem `correlation.id` no baggage, o `MessageId` do SQS vira o correlationId (o poller não lê o body). Implementado em `api/src/shared/messaging/sqs-poller.ts` |
| Outbox | no mesmo `transactional`, o contexto ativo serializado (`propagation.inject` num objeto) vai para a coluna `trace_context jsonb`, junto com o `correlationId` do envelope. O publisher cria o PRODUCER com `links: [{ context: extraído de trace_context }]` e injeta o próprio contexto nos `MessageAttributes` publicados |

Campos de propagação ficam fora do body e do `payloadHash` ([api.md](api.md), seções 9.5 e 12.1).
