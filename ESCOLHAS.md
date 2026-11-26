# Escolhas do projeto

Opções que o enunciado (`REQUISITOS.md`) deixa explicitamente em aberto. Marque a opção escolhida e preencha a justificativa: várias dessas decisões precisam ser defendidas no `ARCHITECTURE.md`.

## Opções com alternativas nomeadas

### 1. ORM
Seção 4 · Justificar no ARCHITECTURE.md, junto com o mapeamento do `Money` e a estratégia transacional
- [x] MikroORM (preferencial)
- [ ] TypeORM (aceito)

Justificativa:

**Schema e migrations fora do ORM.** O MikroORM é usado só para acesso a dados pela aplicação (Unit of Work, `transactional()`, `LockMode`). Tabelas, constraints, índices e triggers são **SQL puro** em `project/database/migrations/`, aplicados pelo **Flyway 13** num container próprio (`database-init`) antes das réplicas da API:
- **Versionadas e reversíveis (§4):** versionadas são `V<n>__*.sql`; repetíveis (funções e triggers recriáveis) são `R__*.sql`. Cada `V<n>` tem a reversão `undo/U<n>__*.sql`, executada pelo serviço `database-undo`, porque o Flyway Community não tem `undo`.
- **Garantias no banco (§5.9):** CHECKs compostos, índice único parcial (reversão uma vez por tipo), FKs compostas (moeda do ledger igual à da wallet) e triggers de imutabilidade do ledger não são expressos pelo diff do ORM. Em SQL ficam explícitos e revisáveis.
- **Um dono só para o schema:** nenhuma das réplicas da API aplica DDL.
- **Verificado:** num PostgreSQL 18 real, 15 violações foram barradas pelo banco, o ciclo `migrate → undo → migrate` deixou o mesmo schema e uma migration editada depois de aplicada foi recusada (`checksum mismatch`).

### 2. Emulador de SQS
Seções 4 e 10
- [ ] LocalStack
- [x] MiniStack

Justificativa:

### 3. Autenticação
Seção 2 · Justificar no ARCHITECTURE.md. Se não implementar, descrever o desenho que adotaria
- [ ] Implementar com IdP externo: Keycloak
- [ ] Implementar com IdP externo: Zitadel
- [ ] Implementar com outro IdP equivalente
- [x] Não implementar

Justificativa:

### 3a. Ponto de extensão (se não implementar autenticação)
Seção 2
- [ ] `AuthGuard` no-op
- [ ] `ProviderIdentityPort`
- [ ] Outro ponto de extensão explícito

Justificativa:

### 4. Estratégia de concorrência por wallet
Seção 8 · Justificar no ARCHITECTURE.md
- [ ] Pessimistic locking
- [x] Optimistic locking com retry limitado
- [ ] Update atômico condicionado
- [ ] Combinação das anteriores

Justificativa:

### 5. Uso do `version` da Wallet
Seção 6.2 · Justificar se não for optimistic locking
- [x] Optimistic locking (sugerido)
- [ ] Outra estratégia

Justificativa:

### 6. Escopo de moedas
Seção 6.1
- [ ] Moeda única `BRL`, com modelo multi-moeda e conflito de moeda testado
- [ ] Multi-moeda completa

Justificativa:

### 7. Persistência do `Money`
Seção 6.1 · Justificar no ARCHITECTURE.md (mapeamento do `Money`)
- [x] Valor e moeda em colunas separadas
- [ ] Outra representação exata reidratada como `Money`

Justificativa:

### 8. Formato da `Idempotency-Key`
Seção 9
- [x] `{providerId}:{externalTransactionId}` (default recomendado)
- [ ] Outro formato

Justificativa:

### 9. Fim do reprocessamento de `PENDING_REFERENCE`
Seção 7.1 · Justificar o critério e o valor
- [x] Limite de tentativas
- [ ] TTL

Justificativa:

### 10. Ledger
Seção 6.4
- [x] Entrada simples por wallet
- [ ] Partidas dobradas (diferencial opcional)

Justificativa:

### 11. Ambiente de testes de integração
Seção 13
- [ ] LocalStack em container
- [x] MiniStack em container

Justificativa:

## Decisões abertas sem alternativas nomeadas

O enunciado deixa a escolha com você, mas não lista opções. Marque quando estiver definida e documentada.

- [ ] **12. Assinatura e retorno de `Wallet.debit` / `credit`** (6.2): manter saldo e ledger consistentes entre si.
- [ ] **13. Transições válidas de `WagerTransaction`** (6.3): definidas e documentadas; estados terminais não transicionam.
- [x] **14. Taxonomia de `failureCode`** (7, 7.2): códigos estáveis e legíveis por máquina; reversão sem saldo com código distinto de aposta sem saldo.

  Decisão: enum `FailureCode` do domínio, em `UPPER_SNAKE_CASE`, gravado em `wager_transactions.failure_code` e repetido no `code` do erro 422, no `TransactionView` e no evento `WagerTransactionRejected`. Tabela completa em `project/docs/api.md` §10.

  | Código | Status | Ação do provedor |
  | --- | --- | --- |
  | `INSUFFICIENT_FUNDS` | REJECTED | desistir |
  | `REVERSAL_INSUFFICIENT_FUNDS` | REJECTED | escalar (operacional) |
  | `CURRENCY_MISMATCH` | REJECTED | corrigir o payload |
  | `WALLET_PLAYER_MISMATCH` | REJECTED | corrigir o payload |
  | `REFERENCE_NOT_FOUND` | REJECTED | desistir ou enviar a referência antes |
  | `REFERENCE_MISMATCH` | REJECTED | corrigir o payload |
  | `REFERENCE_KIND_NOT_ALLOWED` | REJECTED | corrigir o payload |
  | `REFERENCE_NOT_PROCESSED` | REJECTED | desistir |
  | `REFERENCE_ALREADY_REVERSED` | REJECTED | desistir (duplicata de negócio) |
  | `REVERSAL_AMOUNT_MISMATCH` | REJECTED | corrigir o payload |
  | `PROCESSING_RETRIES_EXHAUSTED` | FAILED | reenviar mais tarde |

  Justificativa:
  - **Um código por causa, não por operação.** O provedor decide pelo código, sem interpretar mensagem. Cada código cai num de três destinos (desistir, corrigir o payload, reenviar mais tarde), que é exatamente a pergunta da seção 7.2.
  - **`REVERSAL_INSUFFICIENT_FUNDS` separado de `INSUFFICIENT_FUNDS`**, como exige a regra 9 da seção 7: uma aposta sem saldo é fluxo normal do jogador, enquanto um rollback que deixaria saldo negativo indica que o crédito já foi gasto e precisa de tratamento operacional.
  - **Referência quebrada em cinco códigos** (`NOT_FOUND`, `MISMATCH`, `KIND_NOT_ALLOWED`, `NOT_PROCESSED`, `ALREADY_REVERSED`) porque cada um corresponde a uma regra distinta da seção 7 (regras 2 a 4 e 7.1) e tem ação diferente: só `REFERENCE_NOT_FOUND` admite que a referência ainda chegue.
  - **`WALLET_NOT_FOUND` não é `failureCode`:** sem wallet não há onde ancorar a transação. Persistir uma `REJECTED` exigiria tirar a FK `wager_transactions.wallet_id → wallets.id`, enfraquecendo o schema que a seção 5.9 avalia. Vira `404` sem registro (ver #16). `WALLET_PLAYER_MISMATCH` continua `failureCode`, porque a wallet existe.
  - **`FAILED` tem código próprio** (`PROCESSING_RETRIES_EXHAUSTED`) para ficar auditável e não ser confundido com rejeição de negócio: o payload estava correto, a infraestrutura é que falhou.
  - **Estabilidade:** código publicado nunca é renomeado nem reaproveitado. Código novo entra no enum, no Swagger e na skill na mesma alteração, porque provedores podem ter lógica amarrada ao valor.
- [ ] **15. Limite de tentativas / TTL e backoff de `PENDING_REFERENCE`** (7.1): valores definidos e justificados.
- [x] **16. Mapeamento de status HTTP** (9): distinguir payload inválido, conflito de idempotência, rejeição de negócio, aceite pendente e falha transitória, de forma consistente.

  Decisão (`project/docs/api.md` §11):

  | Situação | Status | `code` |
  | --- | --- | --- |
  | Transação nova `PROCESSED` | `201` | — |
  | Aceita, aguardando referência (`PENDING_REFERENCE`) | `202` | — |
  | Replay idêntico de transação terminal | mesmo status e corpo da resposta original, com `idempotentReplay: true` | — |
  | Replay idêntico de transação ainda `PENDING_REFERENCE` | status do estado atual (`202`, ou `201`/`422` se já resolvida), com `idempotentReplay: true` | — |
  | Payload, params, query ou header inválido | `400` | `REQUEST_VALIDATION_FAILED` |
  | Recurso inexistente (GET), ou `walletId` inexistente no submit | `404` | `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND` |
  | Mesma key com payload diferente; wallet duplicada | `409` | `IDEMPOTENCY_KEY_CONFLICT`, `WALLET_ALREADY_EXISTS` |
  | Rejeição de negócio (`REJECTED`) | `422` | o `failureCode`, mais `transactionId` no corpo |
  | PostgreSQL/SQS indisponível, conflito de lock esgotado | `503` | `DEPENDENCY_UNAVAILABLE`, `CONCURRENCY_CONFLICT` |
  | Erro inesperado | `500` | `INTERNAL_ERROR` |

  Justificativa:
  - **Cada situação da seção 9 tem um status próprio**, e o status sozinho já responde "posso reenviar?": `400`, `409` e `422` não (o mesmo envio dá o mesmo resultado), `503` sim (com a mesma key), `202` não precisa (o sistema conclui sozinho).
  - **`422` para regra de negócio, não `400`:** o payload é válido e a transação foi persistida com `failureCode`. `400` fica só para o que o schema recusa e nunca chega ao domínio.
  - **`409` só para conflito de estado** (key reutilizada com outro payload, wallet duplicada), separado de rejeição de negócio, porque indica erro de integração do provedor e não resultado do jogo.
  - **`202` para `PENDING_REFERENCE`:** a operação foi aceita e será resolvida pelo worker, então não é erro. O provedor acompanha por `GET /wagering/transactions/:id` ou pelos eventos.
  - **`503` para falha transitória**, inclusive lock esgotado: nada foi gravado e reenviar com a mesma `Idempotency-Key` é seguro. O nginx não troca de réplica num `503` (`proxy_next_upstream error timeout`), para não esconder o problema.
  - **Replay de transação terminal devolve o mesmo status**, inclusive `422`: a seção 9 pede "mesma resposta" e a regra 7 da seção 7 pede o resultado original, então o provedor que perdeu a primeira resposta recebe exatamente o que teria recebido. Transação ainda `PENDING_REFERENCE` não tem resultado final, então o replay mostra o estado atual: devolver um `202` velho de algo já resolvido esconderia o resultado. Por isso a rejeição carrega `transactionId` no `ErrorResponse` (campo opcional, preenchido só por `TransactionRejectedError`).
  - **Consistência entre endpoints:** o mapeamento fica só em `STATUS_BY_KIND` no `ErrorHandler`. `WALLET_NOT_FOUND` é `404` em todo endpoint, inclusive no submit.
  - **`walletId` inexistente no submit é `404` sem persistir**, e não `422` persistido: a transação referencia a wallet por FK, e manter essa FK protege o schema contra transações órfãs. Nada é gravado (transação, ledger, outbox), então não há evento `WagerTransactionRejected` e a `Idempotency-Key` não é consumida. Reenviar depois de criar a wallet é seguro e processa normalmente. Pela fila, o caso é erro de negócio terminal: `ack`, log `warn` e inbox marcada, sem DLQ.
- [x] **17. Algoritmo do `payloadHash`** (9): hash de JSON canônico (chaves ordenadas) dos campos de negócio, documentado.

  Decisão (`project/docs/api.md` §9.5): `payloadHash = "v1:" + hex(sha256(utf8(canonicalJson(payload))))`, onde:
  - `payload` é o objeto de negócio **já validado pelo schema**: o body de `POST /wagering/transactions` ou o `data` da mensagem SQS sem `idempotencyKey`. Campos: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money.amount`, `money.currency` e `referenceExternalTransactionId` quando presente;
  - chaves com `undefined` são removidas;
  - `canonicalJson` ordena as chaves por code point em todos os níveis e serializa sem espaços, como o `JSON.stringify`.

  Justificativa:
  - **Hash calculado depois da validação:** o schema `.strict()` já recusou campos desconhecidos e o `amount` já tem escala fixa de 2 casas pela regex, então `"25.00"` é a única forma possível e não há normalização numérica a fazer, nem risco de `25` e `25.00` gerarem hashes diferentes.
  - **Só campos de negócio:** `Idempotency-Key`, `messageId`, `occurredAt`, `type`, `X-Request-Id` e contexto de trace ficam fora. Assim a mesma operação enviada por HTTP e por SQS tem o mesmo hash, e um reenvio com outro `messageId` continua sendo replay e não conflito.
  - **SHA-256:** disponível nativamente (`node:crypto` no Bun), resistente a colisão (duas operações diferentes não podem ser confundidas com replay) e com saída de tamanho fixo para coluna e índice.
  - **Prefixo de versão `v1:`:** se o conjunto de campos ou o algoritmo mudar, o novo hash ganha `v2:` e as transações antigas continuam comparáveis, sem reescrever registros nem transformar replays legítimos em conflitos.
  - **JSON canônico próprio**, sem biblioteca: o payload só tem strings e um objeto aninhado, então ordenar chaves recursivamente é trivial e testável.
- [x] **18. Formato do cursor do ledger** (9): estável e opaco.

  Decisão (`project/docs/api.md` §9.2): paginação por keyset com ordenação `(created_at ASC, id ASC)`. Cursor = `base64url(JSON.stringify({ v: 1, createdAt, id }))` do último item da página. Resposta `{ items, nextCursor }`, com `nextCursor: null` no fim. `limit` de 1 a 200, default 50. Cursor inválido ou de versão desconhecida → `400 REQUEST_VALIDATION_FAILED` com `path: 'cursor'`.

  Justificativa:
  - **Keyset em vez de offset:** o ledger só cresce (é append-only). Com `OFFSET`, um lançamento novo durante a navegação desloca as páginas e gera itens repetidos ou pulados. Com `WHERE (created_at, id) > (:createdAt, :id)`, a página seguinte é sempre a mesma, e o custo é constante no índice `(wallet_id, created_at, id)` mesmo em wallets com muitos lançamentos.
  - **`id` como desempate:** vários lançamentos podem ter o mesmo `created_at`. O `id` é UUIDv7, único e ordenável por tempo, então a ordem é total e determinística.
  - **Ordem crescente:** é a ordem de reconstrução do saldo (`balanceBefore → balanceAfter`), a mesma usada na reconciliação e na auditoria.
  - **Opaco para o cliente:** o schema de entrada só aceita o alfabeto base64url, e o conteúdo é decodificado no service. Isso permite mudar o formato interno sem quebrar contrato. O campo `v` identifica a versão.
  - **base64url** porque vai em query string sem precisar de escape.
  - **`limit + 1` linhas** para saber se existe próxima página sem `COUNT(*)`.
  - **Cursor inválido é `400`**, não `500`: é entrada do cliente, como qualquer outro parâmetro.
- [x] **19. Limite de tentativas antes da DLQ** (10).

  Decisão: **5 entregas** pela aplicação (`SQS_MAX_ATTEMPTS`) e **redrive do SQS em 10** (`maxReceiveCount`, criado pelo `queue-init`).
  - **A aplicação decide primeiro:** na 5ª entrega com falha transitória o consumer grava a transação `FAILED` (`PROCESSING_RETRIES_EXHAUSTED`) e envia a mensagem para a DLQ com o atributo `wagering-dlq-reason`. Se o redrive do SQS agisse antes, a mensagem iria para a DLQ sem o estado `FAILED` no banco.
  - **O redrive é rede de segurança:** cobre o processo que morre no meio de toda entrega (crash loop), quando a aplicação nunca chega a decidir.
  - **Backoff entre entregas:** `ChangeMessageVisibility` com 2, 4, 8, 16… s (teto de 300 s) e jitter entre metade e o total (`src/shared/messaging/retry-backoff.ts`).
  - **Custo conhecido:** mensagens do mesmo grupo devolvidas porque a anterior falhou também contam entrega no SQS. Por isso o redrive fica com folga em relação ao limite da aplicação.
- [ ] **20. Backoff da outbox** (6.5): `scheduleRetry` incrementa `attempts` e calcula `nextAttemptAt`.
- [ ] **21. Interpretações adicionais de regras de negócio** (7): documentadas.
- [ ] **22. Nomes e assinaturas do modelo de domínio** (6): podem ser adaptados se as garantias forem preservadas.
- [x] **27. Processos `api` e `worker`** (8, 10, 11, 13)

  Decisão: **um código e uma imagem, dois serviços no Compose.** A `api` (`src/main.ts`) serve só HTTP atrás do nginx. O `worker` (`src/main.worker.ts`, `NestFactory.createApplicationContext`) não tem servidor HTTP e roda o consumer SQS, o publisher da outbox e o reprocessamento de `PENDING_REFERENCE`.
  - **Mesmo use case nas duas entradas (§10):** o worker importa os mesmos módulos Nest. Não existe um segundo projeto com outra cópia da regra.
  - **Testes de falha (§13):** "worker morto depois do commit e antes do ack" e "outra instância assume a outbox" viram `docker compose kill worker`, sem derrubar o HTTP.
  - **Escala e shutdown independentes:** `--scale api=3 --scale worker=2`. O `SIGTERM` do worker termina a mensagem em andamento e devolve a visibilidade das que não começaram (`stop_grace_period: 30s`).
  - **Health sem HTTP:** o worker grava um heartbeat em arquivo só quando PostgreSQL e SQS respondem, e o healthcheck do container lê a data dele.

## Opcionais

- [x] **23. OpenTelemetry** (12)

  Justificativa: traces, métricas e logs saem da API em OTLP para um **OpenTelemetry Collector**, que separa os sinais: traces para o **Jaeger**, métricas para o **Prometheus** (scrape do exporter do collector) e logs para o **Loki** (ingestão OTLP nativa). A API só conhece o protocolo OTLP, então trocar um backend é mudança de config no collector, não no código.

  - **Instrumentação explícita, não automática:** no Bun os hooks de `require`/`import` usados pela auto-instrumentação do OTel não interceptam `http`, `express`, `nestjs-core` nem `pg`. Isso foi testado: o SDK sobe e não gera nenhum span. Por isso há um middleware HTTP próprio (span SERVER com contexto W3C e histograma `http.server.request.duration` por rota) e um logger JSON que também emite cada log ao OTel com `traceId`/`spanId`. As métricas de negócio da seção 12 (transações por status, duplicatas, retries, DLQ, conflitos de lock, outbox lag) serão instrumentos OTel criados nos services.
  - **Correlação:** o nginx preserva o `X-Request-Id` do cliente, ou gera um. A API grava esse id como `correlationId` no corpo de erro, nos logs e no span (`correlation.id`, via baggage). Do log no Loki chega-se ao trace no Jaeger pelo `trace_id`, e do trace aos logs.
  - **Limitação:** ainda não há spans de banco (o `instrumentation-pg` não funciona no Bun). A latência de banco aparece dentro do span HTTP, mas não separada.
  - **Jaeger fixado em 2.20.0:** a partir da 2.21 o Jaeger removeu a API HTTP v1 (`/api/services`), que o datasource Jaeger do Grafana 13 ainda usa.

- [x] **24. Dashboard de métricas** (12)

  Justificativa: o Grafana sobe já provisionado (datasources Prometheus, Loki e Jaeger, com links log ↔ trace) e com o dashboard **Wagering API** como página inicial. Ele mostra requisições/s, taxa de 5xx, latência p50/p95/p99 por rota, distribuição entre réplicas e logs de warn/error. Os painéis de negócio entram junto com as métricas da seção 12.
- [ ] **25. Teste de carga** com `bun run test:load` (14)
- [ ] **26. Ledger de partidas dobradas** (6.4)

## Fixos (sem escolha)

Bun 1.x como runtime, package manager e test runner; TypeScript estrito; NestJS; PostgreSQL; AWS SQS; Docker Compose; migrations versionadas e reversíveis. Prisma e outros ORMs estão fora do escopo.
