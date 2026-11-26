# database-init — migrations do schema (Flyway)

Container de execução única que aplica as migrations SQL de `database/migrations/` antes das réplicas da `api` subirem. É o único dono do schema: a `api` (MikroORM) só acessa dados e nunca cria nem altera tabelas.

| Item | Valor |
| --- | --- |
| Dockerfile | `database/init.Dockerfile` (`FROM flyway/flyway:13.13.0`, `CMD ["migrate"]`) |
| Arquivos copiados | `database/migrations/` → `/flyway/migrations` |
| Restart | `no`: roda, termina e fica `exited (0)` |
| Depende de | `database` saudável |
| Dependentes | `api` (espera `service_completed_successfully`) |

## Variáveis

| Variável | Valor |
| --- | --- |
| `FLYWAY_URL` | `jdbc:postgresql://database:5432/${POSTGRES_DB}` |
| `FLYWAY_USER` / `FLYWAY_PASSWORD` | `POSTGRES_USER` / `POSTGRES_PASSWORD` |
| `FLYWAY_LOCATIONS` | `filesystem:/flyway/migrations` |
| `FLYWAY_CONNECT_RETRIES` | `10` |
| `FLYWAY_VALIDATE_MIGRATION_NAMING` | `true`: arquivo fora do padrão `V<n>__` / `R__` falha o deploy |
| `FLYWAY_CLEAN_DISABLED` | `true`: `clean` (apagar o schema inteiro) fica bloqueado |

## Como funciona

O Flyway compara os arquivos com a tabela `flyway_schema_history` e aplica, em ordem, só o que falta: primeiro as versionadas (`V<n>__`), depois as repetíveis (`R__`) cujo conteúdo mudou. Cada migration roda numa transação. O checksum de cada arquivo fica gravado, e editar uma migration já aplicada derruba o próximo deploy com `Migration checksum mismatch`. Em erro o container sai com código diferente de `0` e a `api` não sobe.

Arquivos atuais:

| Arquivo | Conteúdo |
| --- | --- |
| `V1__initial_schema.sql` | `wallets`, `wager_transactions`, `wallet_ledger_entries`, `inbox_messages`, `outbox_messages`, com constraints e índices |
| `R__ledger_entries_immutable.sql` | triggers que impedem `UPDATE`, `DELETE` e `TRUNCATE` no ledger |
| `R__wager_transactions_guard.sql` | triggers que impedem transição de estado terminal, mudança de campo de negócio e `DELETE` |

## Operação

```bash
docker compose logs database-init              # o que foi aplicado no último up
docker compose run --rm database-init info     # estado de cada migration
docker compose run --rm database-init validate # confere checksums sem aplicar
docker compose run --rm database-init migrate  # aplica as pendentes
docker compose run --rm database-undo          # reverte a última versionada
```

## database-undo

O Flyway Community não tem `undo`. A reversão vem dos arquivos `database/undo/U<n>__*.sql` (um para cada `V<n>`) e do script `database/scripts/undo.sh`, executado pelo serviço `database-undo` (`database/undo.Dockerfile`: `FROM postgres:18-alpine`, copia `scripts/undo.sh` e `undo/` para `/database`; profile `tools`, que não sobe com `up`).

O script lê a última versão aplicada, executa o `U` correspondente e remove a linha do histórico, tudo numa única transação. Também apaga as linhas dos `R__` do histórico, para o próximo `migrate` reaplicá-los, já que o undo pode ter derrubado triggers junto com as tabelas.

Reverter apaga dados. Com dados reais, desfaça com uma nova `V` em vez do `database-undo`.

## Criar uma migration

1. `database/migrations/V<próximo>__<descricao>.sql` com o SQL da mudança.
2. `database/undo/U<mesmo número>__<mesma descricao>.sql` com a reversão.
3. Teste: `database-init migrate`, `database-undo`, `database-init migrate`.

Convenções, garantias do schema e armadilhas do PostgreSQL: skill [jungle-gaming-database](../database/SKILL.md).
