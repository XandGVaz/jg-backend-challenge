# queue / queue-init — SQS (MiniStack)

## 1. `queue`

Emulador da API do SQS, o [MiniStack](https://github.com/ministackorg/ministack), escolhido em `ESCOLHAS.md` #2.

| Item | Valor |
| --- | --- |
| Dockerfile | `queue/Dockerfile` (`FROM ministackorg/ministack:1.5.44`) |
| Porta | `4566` (publicada em `SQS_PORT`, default `4566`) |
| Healthcheck | `GET /_ministack/health` |
| Estado | em memória: as filas somem quando o container reinicia |

## 2. `queue-init`

Container de execução única, como o [database-init](database-init.md): é o dono das filas. Na AWS esse papel é do Terraform/CloudFormation.

| Item | Valor |
| --- | --- |
| Dockerfile | `queue/init.Dockerfile` (`FROM amazon/aws-cli:2.42.4`) |
| Script | `queue/scripts/create-queues.sh` (idempotente) |
| Restart | `no` |
| Dependentes | `api` e `worker` esperam `service_completed_successfully` |

| Fila | Atributos |
| --- | --- |
| `wager-transactions-dlq.fifo` | FIFO, retenção de 14 dias |
| `wager-transactions.fifo` | FIFO, `ContentBasedDeduplication=false`, `VisibilityTimeout=30`, `RedrivePolicy` para a DLQ com `maxReceiveCount=10` |
| `wallet-events.fifo` | FIFO, `ContentBasedDeduplication=false`, retenção de 14 dias, sem redrive; destino dos eventos da outbox (`ESCOLHAS.md` #28) |

- O produtor precisa mandar `MessageGroupId` (a `walletId`) e `MessageDeduplicationId` (o `messageId` do envelope).
- Na `wallet-events.fifo`, o publisher da outbox manda `MessageGroupId` (o `aggregateId`) e `MessageDeduplicationId` (o `eventId`), com dedup explícita porque o `ContentBasedDeduplication` fica desligado ([api](api.md), seção 13.1).
- A `wallet-events.fifo` não tem redrive: quem consome é externo e deduplica por `eventId`; a retenção de 14 dias cobre um consumidor fora do ar quando o evento sai.
- O redrive em 10 é rede de segurança; a aplicação manda para a DLQ antes, na 5ª entrega (`ESCOLHAS.md` #19).

## 3. Operação

```bash
docker compose logs queue-init
docker compose restart queue && docker compose up -d queue-init   # recria as filas
aws --endpoint-url http://localhost:4566 sqs list-queues           # credenciais: test/test, região us-east-1
aws --endpoint-url http://localhost:4566 sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo --attribute-names All
```
