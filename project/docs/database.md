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

Todo o schema está numa migration só, a `V1__initial_schema.sql` (com a `U1`), porque o projeto ainda não foi para produção: as versões intermediárias foram consolidadas. Além das tabelas de wallets, transações, ledger, inbox e outbox, ela traz:

- `wallet_ledger_entries.wallet_version`, com `uq_wallet_ledger_entries_wallet_version (wallet_id, wallet_version)`: dois lançamentos nunca saem da mesma versão da wallet (`ESCOLHAS.md` #12).
- tabela `rounds`, única por `(provider_id, round_id)`, com `status` `OPEN`/`CLOSED`; `R__rounds_guard.sql` proíbe reabrir, alterar identidade/`opened_at` e apagar. O primeiro `WIN`/`LOSS` fecha a rodada; `BET` depois disso é rejeitada pela aplicação com `ROUND_CLOSED` (`ESCOLHAS.md` #21).
- `wager_transactions.reference_kind`, `uq_wager_transactions_id_kind (id, kind)`, FK composta `fk_wager_transactions_reference_kind` e índice parcial `uq_wager_transactions_bet_reversal_once`: uma `BET` só é estornada uma vez, por `REFUND` ou por `ROLLBACK` (`ESCOLHAS.md` #21).
- `outbox_messages.trace_context jsonb`: o contexto W3C gravado com o evento, para o publisher ligar o span PRODUCER ao request de origem ([jaeger.md](jaeger.md) §6).

Depois que o projeto for para produção, toda mudança volta a ser uma migration nova `V<n>__`, nunca uma edição da `V1`.

`idle_in_transaction_session_timeout` é definido na conexão do MikroORM, para que um processo travado com a transação aberta não segure bloqueios (`ESCOLHAS.md` #13).

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
