# Distributed Wagering Processor — projeto

```
project/
├── docker-compose.yml   # database, database-init, queue, queue-init, api, worker, nginx + otel-collector, jaeger, prometheus, loki, grafana
├── nginx/nginx.conf
├── observability/       # configs do collector, Prometheus, Loki e provisioning do Grafana
├── docs/                # uma documentação por container do Compose
├── .env.example
├── database/            # migrations SQL (Flyway), reversões e script de undo
├── queue/               # emulador SQS (MiniStack) e script que cria as filas
└── api/                 # aplicação NestJS: src/modules/<modulo>/{controllers,services,repositories} (docs/api.md §3.1)
```

## Subir o ambiente

```bash
cp .env.example .env            # opcional: os defaults já funcionam
docker compose up -d --build --scale api=3 --scale worker=2 --wait
```

Nenhum container usa bind mount: cada serviço tem um `Dockerfile` no seu diretório (`database/`, `nginx/`, `observability/<componente>/`, `api/`) que copia os arquivos para a imagem. Depois de alterar uma migration, a config do nginx ou da observabilidade, ou um dashboard, rode `docker compose up -d --build <serviço>`.

| Serviço    | Endereço                                        |
| ---------- | ----------------------------------------------- |
| API        | http://localhost:8080 (via nginx)               |
| Swagger    | http://localhost:8080/docs                      |
| OpenAPI    | http://localhost:8080/docs-json                 |
| Grafana    | http://localhost:3000 (admin/admin; leitura anônima) |
| Jaeger     | http://localhost:16686                          |
| Prometheus | http://localhost:9090                           |
| Loki       | http://localhost:3100                           |
| OTLP HTTP  | http://localhost:4318 (collector)               |
| Postgres   | localhost:5433                                  |
| SQS        | http://localhost:4566 (MiniStack)               |

A `api` não publica porta: todo tráfego passa pelo nginx, que balanceia entre as réplicas e repassa o `X-Request-Id` do cliente, ou gera um. Esse id é o `correlationId` das respostas de erro e dos logs.

## Observabilidade

```
api (OTLP/HTTP) ──> otel-collector ──> Jaeger      (traces)
                                  ├──> Prometheus  (métricas, scrape em :8889)
                                  └──> Loki        (logs, OTLP nativo)
                    Grafana lê os três; dashboard "Wagering API" é a página inicial
```

- Logs: uma linha JSON por evento no stdout (`docker compose logs api`) e o mesmo registro no Loki, com `correlationId`, `traceId` e `spanId`.
- No Grafana, um log leva ao trace no Jaeger pelo `trace_id`, e um trace leva aos logs.
- `OTEL_ENABLED=false` desliga a exportação; a API continua logando JSON no stdout.
- Esquemas: métricas em [docs/prometheus.md](docs/prometheus.md), spans e propagação em [docs/jaeger.md](docs/jaeger.md), campos de log em [docs/loki.md](docs/loki.md), dashboards em [docs/grafana.md](docs/grafana.md). Regras na skill [jungle-gaming-observability](observability/SKILL.md).

O serviço `database-init` aplica as migrations SQL de `database/migrations/` uma única vez e termina; as réplicas da `api` só sobem depois que ele conclui com sucesso. O schema é SQL puro: o MikroORM só acessa dados.

Health checks: `GET /health/live` (processo) e `GET /health/ready` (PostgreSQL e SQS alcançáveis; `503 DEPENDENCY_UNAVAILABLE` quando não). O `worker` não tem HTTP: o healthcheck dele lê um arquivo de heartbeat ([docs/worker.md](docs/worker.md)).

## Desenvolvimento da API

```bash
cd api
bun install
bun run start:dev     # exige DATABASE_URL no ambiente
bun run typecheck
bun run lint
bun test
```

## Migrations (Flyway)

```bash
docker compose run --rm database-init info      # aplicadas e pendentes
docker compose run --rm database-init migrate   # aplica as pendentes
docker compose run --rm database-undo           # reverte a última versionada
```

Nova mudança de schema: `database/migrations/V<n>__<descricao>.sql` e a reversão `database/undo/U<n>__<descricao>.sql`.

## Documentação

### Por container (`docker-compose.yml`)

| Serviço | Documento | Papel |
| --- | --- | --- |
| `database` | [docs/database.md](docs/database.md) | PostgreSQL: wallets, transações, ledger, inbox e outbox |
| `database-init` / `database-undo` | [docs/database-init.md](docs/database-init.md) | aplica as migrations SQL uma vez antes das réplicas; reverte sob demanda |
| `api` | [docs/api.md](docs/api.md) | aplicação NestJS, escalável com `--scale api=3` |
| `worker` | [docs/worker.md](docs/worker.md) | mesma imagem da api sem HTTP: consumer SQS e workers, escalável com `--scale worker=N` |
| `queue` / `queue-init` | [docs/queue.md](docs/queue.md) | emulador SQS (MiniStack); cria `wager-transactions.fifo` e a DLQ com redrive |
| `nginx` | [docs/nginx.md](docs/nginx.md) | entrada HTTP, balanceamento e `X-Request-Id` |
| `otel-collector` | [docs/otel-collector.md](docs/otel-collector.md) | recebe OTLP e distribui traces, métricas e logs |
| `jaeger` | [docs/jaeger.md](docs/jaeger.md) | traces |
| `prometheus` | [docs/prometheus.md](docs/prometheus.md) | métricas |
| `loki` | [docs/loki.md](docs/loki.md) | logs |
| `grafana` | [docs/grafana.md](docs/grafana.md) | dashboards e exploração |

### Enunciado e decisões

- [REQUISITOS.md](../REQUISITOS.md): enunciado do desafio.
- [ESCOLHAS.md](../ESCOLHAS.md): opções em aberto e as escolhidas.

### Skills dos agentes (`SKILL*.md` em cada pasta, não versionadas)

Padrões que valem para qualquer alteração ou revisão do código:

| Skill | Conteúdo |
| --- | --- |
| [jungle-gaming-api](api/SKILL.md) | camadas controller → service → repository, MikroORM (acesso a dados), estilo, guard clauses, ErrorHandler, Zod, Swagger e instrumentação |
| [jungle-gaming-database](database/SKILL.md) | schema em SQL puro, migrations V/R/U com Flyway, reversão, garantias no banco e armadilhas do PostgreSQL |
| [jungle-gaming-dto](api/SKILL-DTO.md) | regras dos contratos e o que conferir em [docs/api.md](docs/api.md) §7–§13 (Money, IDs, endpoints, SQS, eventos, `payloadHash`, `failureCode`, status HTTP) |
| [jungle-gaming-observability](observability/SKILL.md) | regras de métricas, spans, logs e dashboards e o que conferir em `prometheus.md`, `jaeger.md`, `loki.md`, `grafana.md` e `otel-collector.md` |
