# Teste de carga — k6

Diferencial da §14 do `REQUISITOS.md`, decidido no `ESCOLHAS.md` #25: k6 em container próprio, separado da stack testada, para o gerador de carga não disputar CPU com a api e distorcer os números.

## 1. Como rodar

```bash
cd project
docker compose up -d --build --scale api=3 --scale worker=2 --wait
cd api && bun run test:load          # ou: sh project/load-test/run.sh
```

`bun run test:load` chama `project/load-test/run.sh`, que só precisa de `sh`, `curl` e Docker. O relatório sai em `project/load-test/k6-results/<UTC>/` (ignorado pelo git):

| Arquivo | Conteúdo |
| --- | --- |
| `report.md` | ambiente, metodologia, resultados do cliente e do servidor e a seção de análise a preencher |
| `k6.md` | tabela de resultados do k6 |
| `summary.json` | resumo completo do k6, com todas as métricas e percentis |

## 2. Variáveis

| Variável | Default | Uso |
| --- | --- | --- |
| `SCENARIOS` | detectado | lista separada por vírgula entre `health`, `distinct`, `hot` e `duplicate`. Sem valor, roda os quatro se `/wallets` e `/wagering/transactions` existirem, e só `health` se não |
| `RATE` | `50` | iterações por segundo de cada cenário de taxa constante |
| `DURATION` | `60s` | duração de cada cenário de taxa constante |
| `VUS` | `50` | VUs pré-alocadas; no `duplicate`, quantas enviam a mesma aposta ao mesmo tempo |
| `WALLETS` | `20` | wallets criadas no `setup` para o cenário `distinct` |
| `HTTP_PORT` / `PROMETHEUS_PORT` | `8080` / `9090` | portas no host, as mesmas do `.env` |
| `LOAD_TEST_NETWORK` | `wagering_default` | rede do Compose onde o container do k6 roda (alvo: `http://nginx`) |

## 3. Cenários

| Cenário | O que faz | O que mede |
| --- | --- | --- |
| `health` | `GET /health/live` em taxa constante | custo do caminho nginx → réplicas, sem banco |
| `distinct` | apostas de `1.00` em wallets diferentes | throughput sem disputa |
| `hot` | todas as apostas na mesma wallet | conflitos de lock, retries e o custo do bloqueio otimista |
| `duplicate` | a mesma aposta (mesma `Idempotency-Key`) enviada por todas as VUs juntas | idempotência sob concorrência: um débito, o resto replay |

As wallets do `setup` nascem com `1000000.00` para o saldo não acabar durante o teste. Cada aposta usa uma `Idempotency-Key` nova (`load-test:<uuid>`), exceto no `duplicate`.

## 4. Métricas do relatório

| Métrica | Fonte |
| --- | --- |
| Throughput, p50/p95/p99, taxa de erro HTTP | k6 (`http_reqs`, `http_req_duration`, `http_req_failed`), medidos no cliente através do nginx |
| Resultado inesperado | `wagering_http_unexpected`: status fora de `201`, `202`, `422` e `503 CONCURRENCY_CONFLICT`. Limite: menos de 1% |
| Conflitos de lock vistos pelo cliente | `wagering_http_lock_conflicts` (`503` com `code = CONCURRENCY_CONFLICT`) |
| Rejeições e replays | `wagering_http_rejections` (`422`), `wagering_http_replays` (`idempotentReplay: true`) |
| Conflitos de lock no servidor | variação de `wagering_lock_conflicts_total` no Prometheus durante o teste |
| Outbox lag | máximo de `wagering_outbox_lag_seconds` e de `wagering_outbox_pending` no intervalo do teste |

## 5. Estado atual

Os quatro cenários rodam desde que os endpoints de `/wallets` e `/wagering/transactions` existem. Rodada de referência (20 s, 40 iterações/s por cenário, 3 réplicas da api e 2 do worker, Intel Core Ultra 7 256V com 8 CPUs):

| Métrica | Valor |
| --- | --- |
| Requisições | 2454 (122 req/s) |
| Latência p50 / p95 / p99 | 11,0 / 17,7 / 64,8 ms |
| Resultado inesperado | 0 |
| Replays no `duplicate` | 39 de 40 (um débito só) |
| Conflitos de lock no servidor | 15 |
| Pendentes na outbox (máximo) | 90, drenados a zero ao fim do teste |

Duas observações de rodadas anteriores: com o publisher fazendo um lote de 50 por segundo, a outbox chegou a 173 pendentes e não drenava sob a carga; o loop passou a publicar lotes seguidos enquanto voltam cheios. E numa rodada com mais disputa no `hot`, 19 requisições esgotaram as 5 tentativas e responderam `503 CONCURRENCY_CONFLICT`, o custo esperado do bloqueio otimista numa wallet muito disputada.

O valor de `wagering_outbox_lag_seconds` no relatório pode vir de uma série antiga ainda guardada no Prometheus (eventos que esperaram um defeito do publisher, já corrigido): confira o atraso real em `published_at - occurred_at` na tabela.

## 6. Análise

Leitura da rodada de referência da §5. O `report.md` de cada execução traz o mesmo espaço para a análise daquela rodada.

- **Throughput:** 122 req/s é a taxa oferecida, não a capacidade. Três cenários a 40 iterações/s por 20 s, mais as 40 requisições do `duplicate` e o setup, dão as 2454 requisições, e o sistema acompanhou sem fila. O teste não buscou o ponto de saturação, então a capacidade máxima não foi medida.
- **Latência:** p50 de 11 ms e p95 de 17,7 ms. O p99 de 64,8 ms, quase 4 vezes o p95, é compatível com as novas tentativas do bloqueio otimista no `hot`. Essa relação é provável, mas não foi comprovada: o relatório não separa a latência por cenário.
- **Wallet muito disputada:** 15 conflitos de lock em cerca de 800 apostas na mesma wallet (~2%), todos absorvidos pela nova tentativa, com 0 respostas `503`. Numa rodada anterior com mais disputa, 19 requisições esgotaram as 5 tentativas. Esse é o limite do bloqueio otimista sem espera entre tentativas, e é por isso que o modo híbrido continua em aberto (`ARCHITECTURE.md` §9).
- **Idempotência sob carga:** 40 envios simultâneos da mesma aposta resultaram em 1 débito e 39 replays, sem `409` nem `5xx`.
- **Outbox:** o máximo de pendentes foi 90, e a fila voltou a zero ao fim do teste. O lag de 642 s do relatório vem de uma série antiga do Prometheus (§5) e não mede esta rodada. O atraso real desta rodada (`published_at - occurred_at`) não foi registrado.
- **O que os números não mostram:**
  - a latência de cada query, porque não há span de banco por query (`ARCHITECTURE.md` §8);
  - o efeito de dividir a máquina: gerador, 3 réplicas da api, 2 do worker, banco e observabilidade rodam nos mesmos 8 CPUs;
  - o comportamento numa execução longa: são só 20 s, sem aquecimento nem teste de resistência;
  - a entrada pela fila: a carga é só HTTP, então o consumer SQS não é exercitado, e a publicação da outbox vai para o MiniStack, não para o SQS real.
