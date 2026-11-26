# Distributed Wagering Processor

Solução do desafio técnico da Jungle Gaming: um serviço financeiro distribuído que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) vindas de vários provedores. O serviço precisa continuar correto com mensagens duplicadas, fora de ordem ou simultâneas.

Stack: NestJS 12 + Bun, MikroORM 7, PostgreSQL 18 + Flyway, SQS (emulado pelo MiniStack), nginx e OpenTelemetry com Jaeger, Prometheus, Loki e Grafana, tudo em Docker Compose.

## Estrutura

```
.
├── REQUISITOS.md            # enunciado do desafio
├── ESCOLHAS.md              # decisões em aberto e as escolhidas
├── system_architecture/     # documento de arquitetura (architecture.pdf)
└── project/                 # código e infraestrutura
    ├── docker-compose.yml   # todos os serviços
    ├── .env.example         # variáveis (os defaults já funcionam)
    ├── api/                 # NestJS: HTTP (api) e consumer SQS (worker) na mesma imagem
    ├── database/            # migrations SQL do Flyway (V/R) e reversões (U)
    ├── queue/               # emulador SQS e criação das filas
    ├── nginx/               # entrada HTTP e balanceamento das réplicas da api
    ├── observability/       # configs do otel-collector, Prometheus, Loki e Grafana
    └── docs/                # um documento por container do Compose
```

Dentro de `project/api/src/`:

| Pasta | Conteúdo |
| --- | --- |
| `modules/wallets` | criação e consulta de wallets, saldo e ledger |
| `modules/wagering` | submissão e processamento de transações, mensageria (SQS, inbox, outbox) |
| `modules/health` | `GET /health/live` e `GET /health/ready` |
| `worker/` | processo sem HTTP que consome a fila (`main.worker.ts`) |
| `shared/` | erros, HTTP, validação (Zod) e mensageria compartilhados |
| `observability/` | instrumentação OpenTelemetry (logs, métricas, traces) |
| `config/`, `database/` | variáveis de ambiente e conexão do MikroORM |

Cada módulo segue as camadas controller → service → repository, com `domain/` e `persistence/` separados ([docs/api.md](project/docs/api.md) §3.1).

## Como rodar

```bash
cd project
cp .env.example .env    # opcional
docker compose up -d --build --scale api=3 --scale worker=2 --wait
```

A API fica em http://localhost:8080 (Swagger em `/docs`) e o Grafana em http://localhost:3000. A lista completa de endereços, os comandos de desenvolvimento e os de migration estão em [project/PROJECT.md](project/PROJECT.md).

## Documentação

### Visão geral

- [REQUISITOS.md](REQUISITOS.md): enunciado, regras de negócio, contratos esperados e critérios de avaliação.
- [ESCOLHAS.md](ESCOLHAS.md): cada decisão do projeto (ORM, concorrência, idempotência, ledger, autenticação...) com as alternativas consideradas.
- [system_architecture/architecture.pdf](system_architecture/architecture.pdf): arquitetura, fluxos e diagramas.
- [project/PROJECT.md](project/PROJECT.md): como subir, desenvolver e operar o ambiente.

### Por serviço

| Serviço | Documento |
| --- | --- |
| `api` | [project/docs/api.md](project/docs/api.md): camadas, configuração, endpoints e contratos (Money, IDs, SQS, eventos, erros) |
| `worker` | [project/docs/worker.md](project/docs/worker.md): consumer SQS, retentativas e heartbeat |
| `database` | [project/docs/database.md](project/docs/database.md): tabelas de wallets, transações, ledger, inbox e outbox |
| `database-init` / `database-undo` | [project/docs/database-init.md](project/docs/database-init.md): aplicação e reversão das migrations |
| `queue` / `queue-init` | [project/docs/queue.md](project/docs/queue.md): fila FIFO e DLQ |
| `nginx` | [project/docs/nginx.md](project/docs/nginx.md): balanceamento e `X-Request-Id` |
| `otel-collector` | [project/docs/otel-collector.md](project/docs/otel-collector.md): pipeline de telemetria |
| `jaeger` | [project/docs/jaeger.md](project/docs/jaeger.md): spans e propagação de contexto |
| `prometheus` | [project/docs/prometheus.md](project/docs/prometheus.md): catálogo de métricas |
| `loki` | [project/docs/loki.md](project/docs/loki.md): campos e níveis de log |
| `grafana` | [project/docs/grafana.md](project/docs/grafana.md): datasources e dashboards |
