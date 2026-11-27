# Resultados dos testes

Execução de referência em 26/11/2026, com o schema consolidado na `V1`, 3 réplicas da `api`, 2 do `worker` e máquina Intel Core Ultra 7 256V com 8 CPUs. Como rodar cada suíte: [PROJECT.md](../PROJECT.md), seção "Testes".

## Resumo

| Suíte | Comando | Testes | Passaram | Falharam | Duração |
| --- | --- | --- | --- | --- | --- |
| Unidade | `bun run test:unit` | 281 (38 arquivos) | 281 | 0 | 0,3 s |
| e2e (`ErrorHandler` e `SqsPoller`) | `SQS_ENDPOINT=http://localhost:4566 bun run test:e2e` | 13 (2 arquivos) | 13 | 0 | 7,2 s |
| Integração e concorrência (§13) | `E2E_BASE_URL=http://localhost:8080 bun run test:integration` | 19 (2 arquivos) | 19 | 0 | 63,0 s |
| Carga (k6) | `bun run test:load` | 4 cenários | 0 resultados inesperados | — | 20 s |
| Verificação estática | `bun run typecheck`, `bun run lint` | — | 0 erros, 0 avisos | — | — |
| Migrations | `database-init migrate` → `database-undo` → `migrate` | — | esquema idêntico depois da volta | — | — |

## Integração (`test/integration/integration.e2e.spec.ts`)

Contra PostgreSQL e MiniStack reais. Todo teste termina conferindo `saldo da wallet == saldo reconstruído pelo ledger`.

| Grupo | Cenário | Resultado | Duração |
| --- | --- | --- | --- |
| Migrations e constraints | só a `V1` aplicada, com sucesso | passou | 18 ms |
| Migrations e constraints | o banco barra saldo negativo, ledger alterado ou apagado, transação terminal alterada e rodada reaberta | passou | 182 ms |
| Migrations e constraints | segunda wallet do mesmo jogador e moeda: `409 WALLET_ALREADY_EXISTS` | passou | 13 ms |
| Atomicidade | aplicada: transação `PROCESSED`, lançamento com a versão nova da wallet e os dois eventos na outbox, no mesmo commit | passou | 65 ms |
| Atomicidade | rejeitada: transação e evento gravados, sem lançamento e com o saldo intacto | passou | 48 ms |
| Atomicidade | wallet inexistente: `404` e nada gravado | passou | 14 ms |
| Atomicidade | pela fila: inbox marcada no mesmo commit da transação | passou | 562 ms |
| Inbox e redelivery | o mesmo `messageId` entregue duas vezes e a mesma operação com outro `messageId`: um débito só | passou | 526 ms |
| Retry e DLQ | corpo inválido vai para a DLQ com o motivo `invalid_message` | passou | 109 ms |
| Retry e DLQ | banco parado durante a entrega: a mensagem volta com backoff e é processada uma vez quando o banco volta | passou | 9,0 s |
| Recuperação | worker reiniciado retoma a `PENDING_REFERENCE` e a outbox drena | passou | 3,6 s |

## Concorrência (`test/integration/concurrency.e2e.spec.ts`)

Os oito cenários da §13 do REQUISITOS.md, com paralelismo real contra as réplicas.

| # | Cenário | Resultado | Duração |
| --- | --- | --- | --- |
| 1 | a mesma aposta enviada 50 vezes em paralelo: um único débito, um `transactionId`, 49 replays | passou | 168 ms |
| 2 | duas apostas de 80,00 sobre 100,00 ao mesmo tempo (5 repetições): uma `201`, uma `422 INSUFFICIENT_FUNDS`, saldo 20,00 | passou | 253 ms |
| 3 | 20 wallets em paralelo, 10 apostas cada: saldos e débitos independentes | passou | 761 ms |
| 4 | 60 envios simultâneos atendidos por ≥ 3 réplicas distintas da api (confirmado nos logs do nginx) | passou | 936 ms |
| 5 | worker morto com `SIGKILL` durante o processamento de 40 mensagens e reiniciado: cada mensagem com efeito exatamente uma vez | passou | 31,7 s |
| 6 | dois publishers sobre a mesma outbox: todo evento publicado, nenhum reagendado | passou | 1,5 s |
| 7 | `REFUND` e `ROLLBACK` antes da referência: ficam `PENDING_REFERENCE` e se resolvem quando ela chega (saldo final 70,00) | passou | 1,1 s |
| 8 | reinício da api e do worker com 30 envios em andamento: nenhuma transação presa em `PENDING`, débitos iguais aos processados | passou | 12,3 s |

## Unidade (`src/**/*.spec.ts`)

| Área | Arquivos | Testes |
| --- | --- | --- |
| `shared/domain` (Money, Currency, IDs, `failureCode`, eventos) | 5 | 45 |
| `shared/contracts` (schemas de Money, IDs e kinds, `payloadHash`) | 4 | 30 |
| `shared/messaging` (backoff) | 1 | 6 |
| `config` e `database` (env, MikroORM, `runTransaction`) | 3 | 20 |
| `transactions` (domínio, eventos, service, repository, constraints) | 5 | 90 |
| `wagering` (regras de cada kind e idempotência no service, schema, handler SQS) | 3 | 29 |
| `wallets` (domínio, reconciliação, cursor do ledger) | 3 | 13 |
| `rounds` | 5 | 16 |
| `inbox` | 3 | 11 |
| `outbox` | 3 | 17 |
| `auth` | 3 | 4 |
| Total | 38 | 281 |

O `submit-transaction.service.spec.ts` (21 testes) cobre as regras da §7: débito e rejeição por saldo de `BET`, rodada fechada, `BET` já cancelada, `WIN` com e sem referência, `LOSS` sem movimento, `REFUND` e `ROLLBACK` (pendência, valor divergente, kind e rodada da referência, um estorno por `BET`, `ROLLBACK` de prêmio já gasto), moeda e jogador da wallet, e idempotência (replay, payload divergente, replay de rejeição).

## Carga

Rodada de referência de 20 s, com 40 iterações/s por cenário (`health`, `distinct`, `hot`, `duplicate`). Detalhes e análise em [load-test.md](load-test.md) §5 e §6.

| Métrica | Valor |
| --- | --- |
| Requisições | 2454 (122 req/s) |
| Latência p50 / p95 / p99 | 11,0 / 17,7 / 64,8 ms |
| Resultado inesperado | 0 |
| Replays no `duplicate` | 39 de 40 (um débito só) |
| Conflitos de lock no servidor | 15 |
| Pendentes na outbox (máximo) | 90, drenados a zero ao fim |
