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

- **Mesmo emulador no Compose e nos testes (#11):** os testes de integração rodam contra o mesmo serviço que o ambiente local usa (`project/docs/queue.md`).
- **Cobre o que o desafio usa:** filas FIFO, `MessageGroupId`, `MessageDeduplicationId`, `ChangeMessageVisibility` e `RedrivePolicy` para a DLQ. O `sqs-poller.e2e.spec.ts` exercita esse caminho contra o MiniStack.
- **Imagem fixada** (`ministackorg/ministack:1.5.44`), com healthcheck próprio (`/_ministack/health`). As filas são criadas pelo `queue-init`, o dono único delas.
- **Mais leve e open source:** imagem e consumo de memória menores que os do LocalStack, o que pesa numa stack que já sobe 3 réplicas da api, 2 do worker e a observabilidade; e o código é aberto, sem conta ou token para usar.

### 3. Autenticação
Seção 2 · Justificar no ARCHITECTURE.md. Se não implementar, descrever o desenho que adotaria
- [ ] Implementar com IdP externo: Keycloak
- [ ] Implementar com IdP externo: Zitadel
- [ ] Implementar com outro IdP equivalente
- [x] Não implementar

Justificativa:

- **Não vale pontos** (§2 e §14) e não deve competir com correção financeira, concorrência e idempotência pelo tempo disponível.
- **Desenho que seria adotado:** IdP externo (Keycloak ou Zitadel) com OAuth2 *client credentials*, uma credencial por provedor. O `providerId` do token tem de coincidir com o do payload.
- **Fila:** canal interno confiável, mas o `providerId` da mensagem continua passando pelas validações de domínio (§2).
- O ponto de extensão no código é o #3a: `AuthGuard` no-op e `ProviderIdentityPort`.

### 3a. Ponto de extensão (se não implementar autenticação)
Seção 2
- [ ] `AuthGuard` no-op
- [ ] `ProviderIdentityPort`
- [x] Outro ponto de extensão explícito: os dois juntos

Justificativa:

- **Cada peça responde uma pergunta:** o `AuthGuard` (no-op por enquanto) valida o token e o escopo de cada rota HTTP; o `ProviderIdentityPort` entrega aos services a identidade do provedor para a checagem de posse (o `provider-a` só envia e consulta transações com o próprio `providerId`).
- **A porta vale nas duas entradas:** no HTTP a identidade viria do token; na fila vem do `providerId` da mensagem, que a §2 manda continuar validando. O guard sozinho não alcança o worker.
- **Publicar sem consumir é política do broker, não código:** a aplicação não entrega eventos. O papel do provedor teria só `sqs:SendMessage` em `wager-transactions.fifo`, e o dos consumidores só leitura na fila de eventos (IAM). O MiniStack não aplica IAM, então isso fica só documentado.
- **Acesso administrativo fica fora do escopo:** administradores seriam pessoas com papel no IdP (sem tabela própria de usuários, como a §2 exige), checado no guard. O `ProviderIdentityPort` continua específico de provedor e não é alargado para isso.

### 4. Estratégia de concorrência por wallet
Seção 8 · Justificar no ARCHITECTURE.md
- [ ] Pessimistic locking
- [x] Optimistic locking com retry limitado
- [ ] Update atômico condicionado
- [ ] Combinação das anteriores

Justificativa:

- **Sem lock na leitura:** a transação lê a wallet sem bloquear e grava com `UPDATE … WHERE version = :lida`. Wallets diferentes nunca disputam, e não existe lock global (§5.6).
- **Retry da transação inteira:** em `OptimisticLockError`, o `runTransaction` (`api/src/database/run-transaction.ts`) refaz a leitura e a regra, porque o saldo pode ter mudado e a decisão pode virar rejeição (cenário da §8). Até `OPTIMISTIC_LOCK_MAX_ATTEMPTS` tentativas (5 por padrão).
- **Esgotado = falha transitória:** `503 CONCURRENCY_CONFLICT` no HTTP, ou mensagem sem ack na fila. Nada foi gravado, então reenviar com a mesma key é seguro.
- **Conflito é raro no caminho normal:** `MessageGroupId = walletId` já serializa a maior parte do tráfego da fila por wallet. O que sobra (HTTP concorrente, réplicas) é coberto pelo retry.
- **Observável:** `wagering.lock.conflicts{use_case}` e `wagering.retries{operation="optimistic_lock"}`, e um span `db.transaction` por tentativa.
- **Por que não pessimista:** `SELECT … FOR UPDATE` seguraria o lock da wallet durante toda a transação, inclusive leituras, e serializaria também o caso sem disputa. Um modo híbrido para wallet muito disputada fica para o teste de carga (#25) avaliar.
- **Defesa em profundidade:** `CHECK (balance_amount >= 0)`, aritmética do lançamento verificada no banco e `UNIQUE (wallet_id, transaction_id)` no ledger barram o erro mesmo com defeito na aplicação. A `V1` também tem `UNIQUE (wallet_id, wallet_version)` (#12).

### 5. Uso do `version` da Wallet
Seção 6.2 · Justificar se não for optimistic locking
- [x] Optimistic locking (sugerido)
- [ ] Outra estratégia

Justificativa:

- É o mecanismo do #4: `version` começa em 1 e só incrementa quando o saldo muda (§6.2), então serve de token de concorrência sem gerar conflito em operações que não mexem no saldo (`LOSS`, rejeições).
- Não usa a versão automática do MikroORM: o domínio incrementa o `version` (#12), e o MikroORM compararia o valor já incrementado. O `WalletRepository.save` grava com `UPDATE wallets ... WHERE id = ? AND version = <lida>` e lança `OptimisticLockError` quando nenhuma linha muda, o que o `runTransaction` trata como conflito.

### 6. Escopo de moedas
Seção 6.1
- [x] Moeda única `BRL`, com modelo multi-moeda e conflito de moeda testado
- [ ] Multi-moeda completa

Justificativa:

- **Multi-moeda completa contradiz a §6.1:** o contrato fixa a escala em 2 casas, e moedas ISO-4217 com 0 casas (JPY) ou 3 (BHD) não cabem nele.
- **O modelo continua multi-moeda:** `currency char(3)` em todas as tabelas, wallet única por `(player_id, currency)` e FK composta que obriga o lançamento a usar a moeda da wallet. O `Money` recusa operações entre moedas diferentes.
- **Lista de moedas aceitas:** a validação aceita só as moedas de uma lista configurada, hoje só `BRL`. Acrescentar uma moeda de 2 casas é mudar a lista, sem migration. O conflito de moeda (`CURRENCY_MISMATCH`) é testado.

### 7. Persistência do `Money`
Seção 6.1 · Justificar no ARCHITECTURE.md (mapeamento do `Money`)
- [x] Valor e moeda em colunas separadas
- [ ] Outra representação exata reidratada como `Money`

Justificativa:

- **Representação exata:** `amount numeric(20, 2)`, nunca `real`/`double precision`. O tipo `decimal` do MikroORM hidrata a coluna como string, que vira `Money` no repository via `Money.from`. Em nenhum ponto o valor passa por `number` (falha eliminatória, §14).
- **Escala validada antes do banco:** o `numeric` arredondaria um valor com mais de 2 casas, então o schema Zod e o `Money.from` recusam esse valor antes.
- **Moeda em coluna própria (`char(3)`)** permite garantias no banco: wallet única por `(player_id, currency)` e FK composta `(wallet_id, currency)` que obriga o lançamento a usar a moeda da wallet.

### 8. Formato da `Idempotency-Key`
Seção 9
- [x] `{providerId}:{externalTransactionId}` (default recomendado)
- [ ] Outro formato

Justificativa:

- **Derivável pelo provedor:** `{providerId}:{externalTransactionId}` pode ser recalculado a qualquer momento, sem o provedor guardar estado. Um reenvio depois de timeout tem a mesma key.
- **Única entre provedores:** o prefixo evita colisão de `externalTransactionId` iguais em provedores diferentes.
- **O header é a fonte da verdade:** a API não recalcula a key a partir do body nem a compara com ele (`project/docs/api.md` §9.4). O formato é a recomendação para o provedor.
- **Garantida no banco:** `UNIQUE (idempotency_key)` e, de forma independente, `UNIQUE (provider_id, external_transaction_id)`.

### 9. Fim do reprocessamento de `PENDING_REFERENCE`
Seção 7.1 · Justificar o critério e o valor
- [x] Limite de tentativas
- [ ] TTL

Justificativa:

- **Não expira com o worker parado:** as tentativas só avançam quando o agendador roda. Com TTL, uma queda do worker maior que o prazo rejeitaria pendências que nunca foram tentadas.
- **Estado simples no banco:** `reference_attempts` e `next_reference_attempt_at` na própria `wager_transactions`, com índice parcial para as `PENDING_REFERENCE`.
- Os valores (10 tentativas, base de 2 s, teto de 300 s, configuráveis por env) estão no #15.

### 10. Ledger
Seção 6.4
- [x] Entrada simples por wallet
- [ ] Partidas dobradas (diferencial opcional)

Justificativa:

- **Atende ao que a §6.4 exige:** no máximo um lançamento por wallet em cada transação (`UNIQUE (wallet_id, transaction_id)`), com `balanceBefore`, `balanceAfter` e a aritmética verificada no banco.
- **Reconciliação direta:** o saldo da wallet é a soma dos lançamentos na ordem `(created_at, id)`, que é a invariante final de todos os testes (§13).
- **Partidas dobradas é diferencial opcional (#26):** exigiria uma conta da casa como contrapartida e dois lançamentos por transação, aumentando a superfície de erro justamente na área de correção financeira (20 pontos).

### 11. Ambiente de testes de integração
Seção 13
- [ ] LocalStack em container
- [x] MiniStack em container

Justificativa:

- **Containers reais, não mocks:** a §13 exige PostgreSQL e SQS reais, e substituí-los por mocks é falha eliminatória (§14).
- **Mesmo emulador do ambiente local (#2):** um único conjunto de comportamentos para conhecer. Os e2e de SQS rodam contra o `queue` do Compose (`SQS_ENDPOINT=http://localhost:4566 bun test test`) e são pulados sem `SQS_ENDPOINT`.

## Decisões abertas sem alternativas nomeadas

O enunciado deixa a escolha com você, mas não lista opções. Marque quando estiver definida e documentada.

- [x] **12. Assinatura e retorno de `Wallet.debit` / `credit`** (6.2): manter saldo e ledger consistentes entre si.

  Decisão: `debit(money, transactionId, at)` e `credit(money, transactionId, at)` alteram o saldo, incrementam o `version` e **devolvem o `WalletLedgerEntry`** do movimento. Saldo insuficiente **lança um erro de domínio** (subclasse de `AppError`, `BUSINESS_RULE`), que o service converte em transação `REJECTED` com o `failureCode` adequado e, depois do commit, em `422`.

  Justificativa:
  - **A invariante fica dentro do aggregate:** não existe saldo alterado sem lançamento, porque o mesmo método produz os dois (§6.2: "toda alteração de saldo tem um lançamento correspondente").
  - **Erro de domínio para saldo insuficiente:** a `Wallet` não conhece o tipo da operação; o service decide se é `INSUFFICIENT_FUNDS` (aposta) ou `REVERSAL_INSUFFICIENT_FUNDS` (estorno) e grava a rejeição antes de responder.
  - **`wallet_version` no ledger:** cada lançamento grava o `version` resultante da wallet, com `UNIQUE (wallet_id, wallet_version)`. O banco recusa dois lançamentos gerados a partir da mesma versão (proteção contra lost update mesmo com defeito na aplicação), e o ledger ganha uma sequência sem buracos por wallet. Como o `version` só muda quando o saldo muda, `lançamentos = version - 1`, mais o de abertura quando houver saldo inicial. Está na `V1`: a sequência começa em 1 quando há saldo inicial (lançamento de `OPENING`) e em 2 quando não há.
- [x] **13. Transições válidas de `WagerTransaction`** (6.3): definidas e documentadas; estados terminais não transicionam.

  Decisão:

  | De | Para |
  | --- | --- |
  | `PENDING` | `PROCESSED`, `REJECTED`, `FAILED`, `PENDING_REFERENCE` |
  | `PENDING_REFERENCE` | `PROCESSED`, `REJECTED`, `FAILED` |
  | `PROCESSED`, `REJECTED`, `FAILED` | nenhum (erro de programação) |

  Justificativa:
  - **`PENDING` só existe dentro da transação SQL:** a linha é inserida e sai dela num estado final ou em `PENDING_REFERENCE` antes do commit. Se o processo cair, o rollback do PostgreSQL desfaz tudo e nenhuma linha fica presa em `PENDING`; o reenvio com a mesma key processa do zero.
  - **`PENDING_REFERENCE → FAILED` só por infraestrutura:** quando o reprocessamento esgota as tentativas por falha transitória (`PROCESSING_RETRIES_EXHAUSTED`). Uma regra de negócio violada no reprocessamento vira `REJECTED` com o `failureCode` da regra, como define a §6.3.
  - **Transições validadas só no domínio:** os métodos `markProcessed`, `markPendingReference`, `reject` e `fail` lançam `InvalidTransactionStateError` fora da tabela. O banco já garante o que a §5.9 avalia: o trigger `guard_wager_transaction_update` recusa qualquer mudança em estado terminal e nos campos de negócio. Duplicar a tabela de transições num trigger criaria duas cópias da regra.
  - **Processo travado com a transação aberta:** `idle_in_transaction_session_timeout` na conexão do MikroORM encerra a sessão e libera os bloqueios. Sem isso, um processo que trava sem cair seguraria os locks até a conexão morrer. Configurado por `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` (30 s por padrão; `0` desliga), repassado ao `pg` pelo `driverOptions`.
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
  | `BET_ALREADY_CANCELLED` | REJECTED | desistir (aposta já cancelada pelo provedor, #21) |
  | `ROUND_CLOSED` | REJECTED | desistir (rodada já fechada, #21) |
  | `PROCESSING_RETRIES_EXHAUSTED` | FAILED | reenviar mais tarde |

  Justificativa:
  - **Um código por causa, não por operação.** O provedor decide pelo código, sem interpretar mensagem. Cada código cai num de três destinos (desistir, corrigir o payload, reenviar mais tarde), que é exatamente a pergunta da seção 7.2.
  - **`REVERSAL_INSUFFICIENT_FUNDS` separado de `INSUFFICIENT_FUNDS`**, como exige a regra 9 da seção 7: uma aposta sem saldo é fluxo normal do jogador, enquanto um rollback que deixaria saldo negativo indica que o crédito já foi gasto e precisa de tratamento operacional.
  - **Referência quebrada em cinco códigos** (`NOT_FOUND`, `MISMATCH`, `KIND_NOT_ALLOWED`, `NOT_PROCESSED`, `ALREADY_REVERSED`) porque cada um corresponde a uma regra distinta da seção 7 (regras 2 a 4 e 7.1) e tem ação diferente: só `REFERENCE_NOT_FOUND` admite que a referência ainda chegue.
  - **`WALLET_NOT_FOUND` não é `failureCode`:** sem wallet não há onde ancorar a transação. Persistir uma `REJECTED` exigiria tirar a FK `wager_transactions.wallet_id → wallets.id`, enfraquecendo o schema que a seção 5.9 avalia. Vira `404` sem registro (ver #16). `WALLET_PLAYER_MISMATCH` continua `failureCode`, porque a wallet existe.
  - **`FAILED` tem código próprio** (`PROCESSING_RETRIES_EXHAUSTED`) para ficar auditável e não ser confundido com rejeição de negócio: o payload estava correto, a infraestrutura é que falhou.
  - **Estabilidade:** código publicado nunca é renomeado nem reaproveitado. Código novo entra no enum, no Swagger e em `project/docs/api.md` §10 na mesma alteração, porque provedores podem ter lógica amarrada ao valor.
- [x] **15. Limite de tentativas / TTL e backoff de `PENDING_REFERENCE`** (7.1): valores definidos e justificados.

  Decisão: **10 tentativas**, backoff exponencial com **base de 2 s e teto de 300 s** (2, 4, 8 … 256, 300, 300 s, cerca de 18,5 min no total, menos com jitter), pela mesma função de backoff da fila (`src/shared/messaging/retry-backoff.ts`). Os três valores são configuráveis por variável de ambiente (`PENDING_REFERENCE_MAX_ATTEMPTS`, `PENDING_REFERENCE_BACKOFF_BASE_SECONDS`, `PENDING_REFERENCE_BACKOFF_MAX_SECONDS`), já validadas no `env.ts`, e o `retryDelaySeconds` aceita base e teto. O agendador e o gatilho ainda não existem. Com **gatilho imediato**: ao processar uma transação referenciável, o service antecipa (`next_reference_attempt_at = now()`) as `PENDING_REFERENCE` que apontam para ela.

  Justificativa:
  - **Um padrão só de backoff no projeto:** a mesma função serve à fila e à referência, com parâmetros diferentes.
  - **Configurável por env** para os testes encurtarem a janela (o teste "reversão antes da referência" não pode esperar 18 min).
  - **O gatilho separa os papéis:** o crédito sai segundos depois de a referência chegar, independentemente do backoff. O backoff passa a definir só o custo de esperar por uma referência que talvez nunca chegue, e a janela total define quando desistir (`REFERENCE_NOT_FOUND`). O `UPDATE` extra no caminho crítico é servido pelo índice `ix_wager_transactions_reference_lookup`, que já existe.
  - **Janela de cerca de 18 min:** uma referência atrasada costuma chegar em segundos; a janela cobre também retries do lado do provedor.
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
- [x] **20. Backoff da outbox** (6.5): `scheduleRetry` incrementa `attempts` e calcula `nextAttemptAt`.

  Decisão: backoff **exponencial com teto e sem limite de tentativas** (`min(2^attempts s, 300 s)` com jitter, pela mesma função do #15). A reserva das linhas é o **bloqueio da transação durante a publicação**: o publisher lê as pendentes com `FOR UPDATE SKIP LOCKED`, publica e grava `published_at` (ou `scheduleRetry`) na mesma transação.

  Justificativa:
  - **A §11 não admite perder evento:** um limite de tentativas que descarta deixaria um evento confirmado sem publicação. Sem limite, o teto mantém o custo baixo, e a métrica `wagering.outbox.lag` mostra um evento preso.
  - **Bloqueio na transação, sem coluna nova:** se o publisher cair, a conexão fecha, o PostgreSQL desfaz a transação e libera as linhas para outra instância. O custo é segurar a transação durante a chamada ao SQS; o lote pequeno (50) limita isso. Uma coluna de reserva temporária exigiria uma migration e uma regra de expiração.
  - **Duplicação aceita:** se o processo cair entre o `SendMessage` e o commit, o evento sai de novo, com o mesmo `eventId`.
- [x] **21. Interpretações adicionais de regras de negócio** (7): documentadas.

  | Situação | Interpretação | Motivo |
  | --- | --- | --- |
  | `WIN` com referência que não existe | processado sem ligação: a referência é ignorada e `reference_transaction_id` fica nulo. Se a referência existir, vale a regra 2 (`REFERENCE_MISMATCH`) | o enunciado diz que o `WIN` "pode" referenciar a `BET`; rodadas grátis têm `WIN` sem aposta |
  | `LOSS` com referência | `400 REQUEST_VALIDATION_FAILED` na validação (api.md §9.3), coerente com o `CHECK ck_wager_transactions_reference_forbidden` | a `LOSS` não move saldo; a ligação com a aposta é o `roundId` |
  | `ROLLBACK` de um `REFUND` | permitido (regra 3): debita o reembolso e a `BET` volta a valer, mas **não aceita novo `REFUND`** | a regra 4 proíbe reverter a mesma referência duas vezes pelo mesmo tipo |
  | `REFUND` e `ROLLBACK` da mesma `BET` | **uma `BET` é estornada uma vez só, por qualquer tipo**: o segundo é `REJECTED` com `REFERENCE_ALREADY_REVERSED` | os dois creditariam a aposta, e crédito duplicado é falha eliminatória (§14) |
  | `BET` que chega depois de um `REFUND` rejeitado que a citava | `REJECTED` com `BET_ALREADY_CANCELLED` | o provedor já tinha cancelado a aposta (caso típico de timeout); processá-la debitaria o jogador por uma aposta cancelada |
  | Rodada | **entidade com fechamento** (tabela `rounds`, única por `provider_id` + `round_id`): o primeiro `WIN` ou `LOSS` fecha a rodada; depois disso, `BET` na rodada é `REJECTED` com `ROUND_CLOSED`, e `WIN`, `REFUND` e `ROLLBACK` continuam aceitos | torna explícita uma regra de jogo que, sem a entidade, o sistema não enxergaria; prêmios múltiplos e correções continuam possíveis |
  | `OPENING` com saldo inicial `0.00` | grava a transação `OPENING` `PROCESSED`, **sem lançamento** (o ledger exige `amount > 0` e o saldo não muda) | comprova a abertura da wallet no histórico sem violar a invariante "toda alteração de saldo tem lançamento" |

  No schema (`V1`): a tabela `rounds` com o guard `R__rounds_guard.sql` e a regra "uma reversão por `BET`" (`reference_kind` + `uq_wager_transactions_bet_reversal_once`). No código: `ROUND_CLOSED` e `BET_ALREADY_CANCELLED` no enum `FailureCode`. Falta a lógica que os aplica, que depende do caso de uso de submit.
- [x] **22. Nomes e assinaturas do modelo de domínio** (6): podem ser adaptados se as garantias forem preservadas.

  Decisão: **manter os nomes e assinaturas do enunciado** (`Money.from`, `Wallet.open`, `rehydrate`, `markPendingReference`, `scheduleRetry`…). As únicas assinaturas que o enunciado deixa livres são as de `debit`/`credit` (#12).

  Justificativa: quem corrige procura as classes e métodos da §6; cada desvio teria de ser justificado no `ARCHITECTURE.md`.
- [x] **29. Biblioteca decimal do `Money`** (6.1)

  Decisão: **`decimal.js`**, encapsulada no `Money` (`src/shared/domain/money.ts`), com um construtor clonado de precisão alta para as operações não arredondarem.

  Justificativa: biblioteca madura de precisão arbitrária e arredondamento configurável. Com a escala fixa de 2 casas, `bigint` em centavos também resolveria, mas `decimal.js` deixa espaço para divisão ou outras escalas sem trocar o tipo interno.

- [x] **28. Destino dos eventos de integração** (11)

  Decisão: uma fila **`wallet-events.fifo`**, com `MessageGroupId = aggregateId` e `MessageDeduplicationId = eventId`. Criada pelo `queue-init`, sem redrive e com retenção de 14 dias; o nome chega à aplicação por `SQS_WALLET_EVENTS_QUEUE`. O publisher da outbox ainda não existe.

  Justificativa: o enunciado define os eventos, mas não o destino. Uma fila FIFO única é coberta pelo MiniStack e mantém a ordem por agregado. SNS FIFO com uma fila por consumidor só se justificaria com mais de um consumidor.

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
- [x] **25. Teste de carga** com `bun run test:load` (14)

  Decisão: **k6 em container** (`grafana/k6:1.0.0`), chamado por `bun run test:load` (`project/load-test/run.sh` roda o k6 na rede do Compose contra o nginx; detalhes em `project/docs/load-test.md`). Hoje só o cenário `health` roda: os de aposta (`distinct`, `hot`, `duplicate`) esperam os endpoints de `/wallets` e `/wagering/transactions`. Relatório com ambiente, metodologia, throughput, p50/p95/p99, taxa de erro, conflitos de concorrência e outbox lag (§14).

  Justificativa: o k6 é a ferramenta de mercado para isso, e rodar o gerador de carga isolado do sistema testado evita que ele dispute CPU com a api e distorça os números. A dependência extra (uma imagem) compensa a fidelidade do resultado.
- [ ] **26. Ledger de partidas dobradas** (6.4)

  Decisão: **não implementar**; manter a entrada simples por wallet (#10). Partidas dobradas exigiriam uma conta da casa e dois lançamentos por transação, aumentando a superfície de erro na área de correção financeira (20 pontos).

## Fixos (sem escolha)

Bun 1.x como runtime, package manager e test runner; TypeScript estrito; NestJS; PostgreSQL; AWS SQS; Docker Compose; migrations versionadas e reversíveis. Prisma e outros ORMs estão fora do escopo.
