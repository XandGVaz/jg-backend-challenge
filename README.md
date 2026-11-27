# Distributed Wagering Processor

Solução do desafio técnico da Jungle Gaming: um serviço financeiro distribuído que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) vindas de vários provedores. O serviço precisa continuar correto com mensagens duplicadas, fora de ordem ou simultâneas.

Stack: NestJS 12 + Bun, MikroORM 7, PostgreSQL 18 + Flyway, SQS (emulado pelo MiniStack), nginx e OpenTelemetry com Jaeger, Prometheus, Loki e Grafana, tudo em Docker Compose.

## Estrutura

```
.
├── Makefile                 # atalhos para subir, testar e operar (`make` lista os comandos)
├── REQUISITOS.md            # enunciado do desafio
├── ESCOLHAS.md              # decisões em aberto e as escolhidas
├── ARCHITECTURE.md          # decisões, trade-offs e limitações
├── formal_documentation/    # documentação formal: UML, diagramas de sistema e de arquitetura (architecture.pdf)
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

Pré-requisito: Docker com o plugin Compose. O `make` é opcional, e o Bun também: sem ele instalado, o Makefile roda os comandos da API num container `oven/bun`.

### Opção 1: com o Makefile (na raiz do repositório)

```bash
make            # lista todos os comandos, agrupados, com exemplos
make env        # opcional: cria project/.env a partir do .env.example
make up         # constrói e sobe a stack (3 réplicas da api, 2 do worker) e espera ficar saudável
make ps         # estado de cada container
make logs SERVICE=worker
make down       # para tudo (mantém os volumes); `make clean` também apaga os dados
```

O número de réplicas pode mudar: `make up API_REPLICAS=5 WORKER_REPLICAS=3`.

### Opção 2: com o Docker Compose diretamente

```bash
cd project
cp .env.example .env    # opcional: os defaults já funcionam
docker compose up -d --build --scale api=3 --scale worker=2 --wait
docker compose ps
docker compose logs -f worker
docker compose down     # `down -v` também apaga os volumes
```

Com a stack de pé, a API fica em http://localhost:8080 (Swagger em `/docs`) e o Grafana em http://localhost:3000 (admin/admin). A lista completa de endereços, os comandos de desenvolvimento e os de migration estão em [project/PROJECT.md](project/PROJECT.md).

## Como testar

| Comando `make` | Equivalente direto (em `project/api`) | O que roda | Precisa da stack? |
| --- | --- | --- | --- |
| `make test-unit` | `bun test src` | testes unitários | não |
| `make test-e2e` | `SQS_ENDPOINT=http://localhost:4566 bun test test` | e2e contra o SQS do emulador (MiniStack) | sim |
| `make test` | `bun test` | todos; sem a stack, os e2e de SQS são pulados | opcional |
| `make typecheck` | `bun run typecheck` | checagem de tipos do TypeScript | não |
| `make lint` | `bun run lint` | linter (oxlint) | não |
| `make check` | os três acima | typecheck, lint e unitários, antes de um commit | não |
| `make test-integration` | `E2E_BASE_URL=http://localhost:8080 bun run test:integration` | integração e concorrência da §13 contra PostgreSQL e MiniStack reais; para e reinicia containers | sim |
| `make test-load` | `bun run test:load` | teste de carga com k6 em container ([docs/load-test.md](project/docs/load-test.md)) | sim |

Sem o Makefile, rode `bun install` em `project/api` antes dos comandos da segunda coluna. Os resultados da execução de referência estão em [project/docs/test-results.md](project/docs/test-results.md). O teste de carga aceita `RATE`, `DURATION`, `VUS` e `SCENARIOS`, por exemplo `make test-load RATE=100 DURATION=2m`.

## Documentação

### Visão geral

- [REQUISITOS.md](REQUISITOS.md): enunciado, regras de negócio, contratos esperados e critérios de avaliação.
- [ARCHITECTURE.md](ARCHITECTURE.md): decisões, trade-offs, estratégia transacional, concorrência, idempotência e limitações conhecidas.
- [ESCOLHAS.md](ESCOLHAS.md): cada decisão do projeto (ORM, concorrência, idempotência, ledger, autenticação...) com as alternativas consideradas.
- [formal_documentation/architecture.pdf](formal_documentation/architecture.pdf): documentação formal do sistema, com os diagramas UML (sequência do processamento de uma transação, máquina de estados de `WagerTransaction` e modelo de dados), o diagrama do sistema (contexto, componentes e topologia do Docker Compose) e os diagramas das arquiteturas adotadas: a de sistema (serviços, filas e fluxos entre eles) e a de código (camadas controller → service → repository e a direção das dependências).
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
| teste de carga | [project/docs/load-test.md](project/docs/load-test.md): k6 em container, cenários e relatório (`bun run test:load`) |
