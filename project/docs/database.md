# database — PostgreSQL

Banco transacional da aplicação. Guarda wallets, transações, ledger, inbox e outbox. As invariantes financeiras (unicidade, imutabilidade do ledger, saldo não negativo) são aplicadas no schema.

| Item | Valor |
| --- | --- |
| Dockerfile | `database/Dockerfile` (`FROM postgres:18-alpine`) |
| Porta no host | `${POSTGRES_PORT:-5433}` → `5432` |
| Volume | `database-data` → `/var/lib/postgresql` |
| Healthcheck | `pg_isready` a cada 5 s, 10 tentativas |
| Dependentes | `database-init` e `database-undo` (esperam `service_healthy`), `api` |

## Variáveis

| Variável | Default | Uso |
| --- | --- | --- |
| `POSTGRES_DB` | `wagering` | nome do banco |
| `POSTGRES_USER` | `wagering` | usuário da aplicação e das migrations |
| `POSTGRES_PASSWORD` | `wagering` | senha (troque fora do ambiente local) |
| `POSTGRES_PORT` | `5433` | porta publicada no host (5433 evita conflito com um Postgres local) |

Dentro da rede do Compose a URL é `postgres://wagering:wagering@database:5432/wagering`. Do host, use a porta `5433`.

## Schema

O schema não é criado pelo container nem pelo ORM: ele vem das migrations SQL de `database/migrations/`, aplicadas pelo serviço [`database-init`](database-init.md). Toda mudança de schema é uma migration nova `V<n>__` com a reversão `database/undo/U<n>__`.

## Operação

```bash
# psql dentro do container
docker compose exec database psql -U wagering -d wagering

# do host
psql postgres://wagering:wagering@localhost:5433/wagering

# tabelas e migrations aplicadas
docker compose exec database psql -U wagering -d wagering -c '\dt'
docker compose run --rm database-init info
```

Para apagar os dados e recomeçar do zero:

```bash
docker compose down -v   # remove também prometheus-data, loki-data e grafana-data
```

## Falhas

- Banco fora do ar: `GET /health/ready` responde `503 DEPENDENCY_UNAVAILABLE` e as requisições financeiras retornam `503`. O nginx não tira a réplica do balanceamento por isso (o `503` é resposta da aplicação).
- `database-init` falhando (banco indisponível, checksum divergente ou SQL com erro) impede a `api` de subir (`service_completed_successfully`).
