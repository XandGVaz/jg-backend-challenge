# worker — consumer SQS e workers em segundo plano

Mesmo código e mesma imagem da [api](api.md), com outro entrypoint: `src/main.worker.ts` sobe um `NestFactory.createApplicationContext(WorkerModule)`, sem servidor HTTP. Decisão em `ESCOLHAS.md` #27.

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `api/Dockerfile` (o mesmo da api) |
| Comando | `bun src/main.worker.ts` (`command` no Compose) |
| Porta | nenhuma |
| Réplicas | `docker compose up --scale worker=2` |
| Healthcheck | arquivo `/tmp/worker-heartbeat` alterado há menos de 30 s |
| `stop_grace_period` | `30s`: tempo para terminar a mensagem em andamento antes do `SIGKILL` |
| Depende de | `database-init` e `queue-init` concluídos, `otel-collector` iniciado |

## 2. Variáveis

Além das da [api](api.md) (seção 2), exceto `PORT` e `SWAGGER_ENABLED`:

| Variável | Default | Uso |
| --- | --- | --- |
| `SQS_WAIT_TIME_SECONDS` | `20` | long polling: quanto o `ReceiveMessage` espera por mensagem (0 a 20) |
| `SQS_MAX_MESSAGES` | `10` | mensagens por `ReceiveMessage` (1 a 10) |
| `SQS_MAX_ATTEMPTS` | `5` | entregas antes de a aplicação mandar para a DLQ (`ESCOLHAS.md` #19) |
| `WORKER_HEARTBEAT_FILE` | `/tmp/worker-heartbeat` | arquivo lido pelo healthcheck |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `10000` | intervalo do heartbeat |

## 3. Módulos

```
src/main.worker.ts            # entrypoint
src/worker/
├── worker.module.ts          # Observability, Database, Sqs, Health, Wagering (sem HttpModule)
└── worker-heartbeat.service.ts
src/shared/messaging/
├── sqs.module.ts             # SQSClient + QueueRegistry (também usado pela api no readiness)
├── queue-registry.ts         # nome → URL (cache) e checkConnection()
├── sqs-poller.ts             # long polling, ordem por grupo, ack/retry/DLQ, shutdown
├── message-handler.ts        # contrato MessageHandler e MessageOutcome
├── retry-backoff.ts          # 2, 4, 8… até 300 s, com jitter
└── messaging.metrics.ts      # wagering.sqs.messages
```

O `SqsPoller` é o transporte. O consumer de cada fila (em `modules/<modulo>/messaging/`) cria um poller no `onApplicationBootstrap`, passa um `MessageHandler` que valida a mensagem com Zod e chama **um** service, e para o poller no `beforeApplicationShutdown`. Cada mensagem roda dentro de `RequestContext.create(em, ...)`.

## 4. Ciclo de uma mensagem

| Resultado do handler | O que o poller faz | Métrica `wagering.sqs.messages` |
| --- | --- | --- |
| `Ack` | `DeleteMessage` | `outcome=ack` |
| `Retry`, ou o handler lança | `ChangeMessageVisibility` com o backoff da entrega atual; as próximas do mesmo grupo voltam com visibilidade 0 | `outcome=retry` |
| `DeadLetter` | `SendMessage` na DLQ (mesmo body, atributos e `MessageGroupId`, mais `wagering-dlq-reason`) e depois `DeleteMessage` | `outcome=dlq`, `reason` |

- Mensagens do mesmo `MessageGroupId` (a wallet) são processadas em ordem, uma por vez. Grupos diferentes rodam em paralelo.
- Falha no próprio ack/retry/DLQ não perde a mensagem: ela volta quando o visibility timeout da fila (30 s) vencer.
- Erro `TRANSIENT` (`AppError`) loga `warn`; qualquer outro erro loga `error` com stack. Os dois viram retry.

## 5. Shutdown

`SIGTERM` → `beforeApplicationShutdown`: o poller cancela o long polling em andamento, termina as mensagens que já começaram e devolve (visibilidade 0) as que não começaram. Depois, `onApplicationShutdown` fecha o cliente SQS, o banco e exporta a telemetria.

## 6. Operação

```bash
docker compose logs -f worker
docker compose kill worker                  # crash: as mensagens em andamento voltam após o visibility timeout
docker compose up -d --scale worker=2 worker
```

Desenvolvimento fora do container (a partir de `api/`):

```bash
SQS_ENDPOINT=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
DATABASE_URL=postgres://wagering:wagering@localhost:5433/wagering bun run start:worker:dev
SQS_ENDPOINT=http://localhost:4566 bun test test/sqs-poller.e2e.spec.ts   # contra o MiniStack do Compose
```

## 7. Estado atual

O processo, o transporte (`SqsPoller`) e o heartbeat estão prontos e testados contra o MiniStack. O consumer de `wager-transactions.fifo`, o publisher da outbox e o scheduler de `PENDING_REFERENCE` entram junto com o caso de uso de submit, que ainda não existe.
