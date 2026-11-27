# api — aplicação NestJS

Serviço financeiro: API HTTP (wallets, wagering, ledger, reconciliação, health). Roda em várias réplicas atrás do [nginx](nginx.md). O mesmo código, com outro entrypoint, roda os workers (consumer SQS, publisher da outbox, reprocessamento de `PENDING_REFERENCE`) no serviço [worker](worker.md).

As seções 7 a 13 são a **referência dos contratos de dados** (DTOs).

## 1. Container

| Item | Valor |
| --- | --- |
| Dockerfile | `api/Dockerfile` (`oven/bun:1-alpine`, usuário `bun`; copia `package.json`, `tsconfig.json` e `src/`) |
| Comando | `bun src/main.ts` (`command` no Compose, como o [worker](worker.md)) |
| Porta | `3000` interna, **não publicada** (acesso pelo nginx) |
| Réplicas | `docker compose up --scale api=3` (sem `container_name`) |
| Healthcheck | `GET /health/live` a cada 10 s |
| Depende de | `database-init` e `queue-init` concluídos com sucesso, `otel-collector` iniciado |

## 2. Variáveis

Validadas por Zod na inicialização (`api/src/config/env.ts`). Variável inválida derruba o processo com a lista de erros.

| Variável | Default (Compose) | Uso |
| --- | --- | --- |
| `NODE_ENV` | `production` | `development` liga o debug do MikroORM |
| `PORT` | `3000` | porta HTTP |
| `DATABASE_URL` | montada a partir de `POSTGRES_*` | conexão com o [database](database.md); se ausente, é montada de `DB_*` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | ausentes / `5432` | alternativa à `DATABASE_URL` para segredos injetados um a um (Secrets Manager no ECS); usuário e senha são codificados na URL |
| `DATABASE_SSL_MODE` | `disable` | `require` cifra sem validar o certificado; `verify-full` valida cadeia e host |
| `DATABASE_SSL_CA_FILE` | ausente | CA usada no `verify-full`; ausente = raízes públicas (basta para o RDS Proxy). A imagem traz o bundle do RDS em `/etc/ssl/certs/rds-global-bundle.pem` |
| `DATABASE_POOL_MIN` / `DATABASE_POOL_MAX` | `0` / `10` | pool por réplica; a soma de api e workers precisa caber no `max_connections` do banco ou do proxy |
| `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | `30000` | `idle_in_transaction_session_timeout` de cada conexão do pg: encerra a sessão de um processo travado com a transação aberta (`ESCOLHAS.md` #13); `0` desliga |
| `SWAGGER_ENABLED` | `true` | expõe `/docs` e `/docs-json` |
| `OTEL_ENABLED` | `true` | exporta traces, métricas e logs |
| `OTEL_SERVICE_NAME` | `wagering-api` | vira `job` no Prometheus e `service_name` no Loki |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | [otel-collector](otel-collector.md) |
| `OPTIMISTIC_LOCK_MAX_ATTEMPTS` | `5` | tentativas da transação em conflito de bloqueio otimista, contando a primeira; esgotadas, `503 CONCURRENCY_CONFLICT` (`runTransaction`, `api/src/database/run-transaction.ts`) |
| `AWS_REGION` | `us-east-1` | região do SQS |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `test` / `test` | só no emulador; lidas pela cadeia padrão do SDK, fora do schema Zod. Na AWS vêm da IAM role |
| `SQS_ENDPOINT` | `http://queue:4566` | só no emulador ([queue](queue.md)); ausente = endpoint real da região |
| `SQS_WAGER_TRANSACTIONS_QUEUE` / `SQS_WAGER_TRANSACTIONS_DLQ` | `wager-transactions.fifo` / `wager-transactions-dlq.fifo` | nomes das filas (precisam terminar em `.fifo`) |
| `SQS_WALLET_EVENTS_QUEUE` | `wallet-events.fifo` | fila FIFO de destino dos eventos publicados pela outbox no worker (`ESCOLHAS.md` #28); precisa terminar em `.fifo` |

As variáveis só do worker (`SQS_WAIT_TIME_SECONDS`, `SQS_MAX_MESSAGES`, `SQS_MAX_ATTEMPTS`, `WORKER_HEARTBEAT_*`) estão em [worker.md](worker.md).

## 3. Endpoints

Pelo nginx em `http://localhost:8080`:

| Caminho | Descrição |
| --- | --- |
| `GET /health/live` | processo vivo |
| `GET /health/ready` | PostgreSQL e as duas filas SQS alcançáveis; `503 DEPENDENCY_UNAVAILABLE` se não |
| `/docs` | Swagger UI |
| `/docs-json` | OpenAPI gerado a partir dos schemas Zod |
| `/wallets`, `/wagering/transactions`, `/providers/...` | contratos das seções 9 e 11 |

### 3.1 Módulos e camadas

Cada módulo Nest em `api/src/modules/` separa as camadas em pastas próprias. A requisição entra pelo controller, que chama um service, que usa os repositories:

```
src/modules/
├── auth/            # AuthGuard global (no-op) + ProviderIdentityPort (ESCOLHAS #3a)
├── health/          # GET /health/live, /health/ready (sem repository)
├── transactions/    # WagerTransaction: domínio (#13), eventos, EntitySchema e TransactionsService
├── wallets/         # /wallets, ledger, reconciliação; Wallet, WalletLedgerEntry e WalletsService
├── rounds/          # rodada com fechamento (#21) e RoundsService
├── inbox/           # dedup do consumer SQS por (consumer_name, message_id)
├── outbox/          # OutboxMessage, enqueue na transação e publishDue (SKIP LOCKED)
└── wagering/        # /wagering/transactions, /providers/...: SubmitTransactionService
    ├── controllers/
    ├── services/    # submit (idempotência, regras §7, saldo, eventos), resume, failExhausted
    ├── messaging/   # schema da mensagem SQS, handler e consumer (só no worker)
    └── wagering.module.ts
src/worker/          # consumer, agendador de PENDING_REFERENCE e loop do publisher da outbox
```

Dependências entre módulos, só de cima para baixo: `wagering` → `wallets`, `rounds`, `inbox`, `outbox`, `transactions`; `wallets` → `transactions`, `outbox`. O `transactions` existe à parte porque a abertura de wallet grava a transação `OPENING`, e o wagering depende das wallets.

| Camada | Pasta | Faz | Não faz |
| --- | --- | --- | --- |
| Controller | `controllers/` | schema Zod, Swagger, chama um método de service | acessar `EntityManager` ou repository, regra de negócio |
| Service | `services/` | abre a transação, orquestra repositories e domínio, lança `AppError` | conhecer HTTP, escrever SQL |
| Repository | `repositories/` | consulta, lock, `persist`, traduz violação de constraint para `AppError` | `flush`, transação, regra de negócio, DDL |

Cada módulo exporta os mapeamentos de `persistence/index.ts`, registrados em `src/database/entities.ts`. O schema vem das migrations de `database/migrations/` ([database-init](database-init.md)).

## 4. Telemetria

Sem auto-instrumentação (no Bun os hooks do OTel não interceptam `http`, `express` nem `pg`). O middleware `api/src/observability/http-telemetry.middleware.ts` cria o span SERVER e o histograma `http.server.request.duration`. O `JsonLogger` escreve JSON no stdout e envia o mesmo registro ao Loki. Catálogos: métricas em [prometheus.md](prometheus.md), spans em [jaeger.md](jaeger.md), campos de log em [loki.md](loki.md).

## 5. Operação

```bash
docker compose up -d --build --scale api=3 --wait
docker compose logs -f api                      # JSON de todas as réplicas
docker compose ps api                           # réplicas e estado do healthcheck
docker compose up -d --no-deps --build api      # rebuild só da api
```

Desenvolvimento fora do container (a partir de `api/`):

```bash
bun install
DATABASE_URL=postgres://wagering:wagering@localhost:5433/wagering bun run start:dev
bun run typecheck && bun run lint && bun test
```

### 5.1 Na AWS

A mesma imagem roda no ECS Fargate atrás de um ALB, sem mudança de código:

- **SQS:** não defina `SQS_ENDPOINT` nem `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. O SDK usa o endpoint da região e as credenciais temporárias da task role.
- **Banco:** injete `DB_USER`/`DB_PASSWORD` do Secrets Manager (`secrets` da task definition, chaves `username`/`password` do segredo do RDS) e aponte `DB_HOST` para o endpoint do RDS Proxy. Use `DATABASE_SSL_MODE=verify-full`; conectando direto na instância, acrescente `DATABASE_SSL_CA_FILE=/etc/ssl/certs/rds-global-bundle.pem`.
- **Correlation id:** o ALB não envia `X-Request-Id`. Sem o header, a api gera um UUID, e devolve o valor no header `X-Request-Id` da resposta em todos os casos.
- **Flyway (`database-init`):** roda como task ECS avulsa antes do deploy, com `FLYWAY_URL=jdbc:postgresql://<host>:5432/<db>?sslmode=verify-full` e o usuário de migração.

## 6. Shutdown

`app.enableShutdownHooks()` trata `SIGTERM`: o `ObservabilityModule` faz flush de spans, métricas e logs pendentes, e o `SqsModule` fecha o cliente SQS. O shutdown dos workers está em [worker.md](worker.md), seção 5.

## 7. Onde cada contrato vive no código

| Tipo de contrato | Arquivo | Tecnologia |
| --- | --- | --- |
| Primitivos compartilhados (Money, IDs, paginação, payloadHash) | `src/shared/contracts/` | Zod |
| Request/response HTTP de um módulo | `src/modules/<modulo>/<nome>.schema.ts` | Zod + `.meta({ id })` |
| Mensagem SQS de entrada | `src/modules/wagering/messaging/<nome>.schema.ts` | Zod |
| Corpo de erro | `src/shared/http/error-response.schema.ts` | Zod |
| Eventos de integração (saída) | `src/modules/<modulo>/domain/events/<evento>.event.ts` | Classe TS (domínio, sem Zod) |
| Mappers domínio → DTO | `src/modules/<modulo>/<nome>.mapper.ts` | Funções puras `toXView` |
| Status HTTP de sucesso do submit | `src/modules/wagering/wagering.http.ts` (`SUBMIT_STATUS_BY_RESULT`) | mapa |

## 8. Primitivos

### 8.1 Money

```ts
// src/shared/contracts/money.schema.ts
const AMOUNT = /^(0|[1-9]\d*)\.\d{2}$/;          // entrada: não negativa, escala 2
const SIGNED_AMOUNT = /^-?(0|[1-9]\d*)\.\d{2}$/;  // saída: diferença da reconciliação

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/).meta({ example: 'BRL' });

export const MoneySchema = z
  .object({
    amount: z.string().regex(AMOUNT, 'Expected a non-negative decimal with 2 places').meta({ example: '25.00' }),
    currency: CurrencySchema,
  })
  .strict()
  .meta({ id: 'Money' });

export const SignedMoneySchema = MoneySchema.extend({
  amount: z.string().regex(SIGNED_AMOUNT).meta({ example: '-5.00' }),
}).meta({ id: 'SignedMoney' });
```

- `amount` tem exatamente 2 casas: `"25.00"`. Recusados: `25`, `"25"`, `"25.0"`, `"2.5e1"`, `"+25.00"`, `" 25.00"`, `"025.00"`, `NaN`, `Infinity`, string vazia.
- Moeda: ISO-4217 em maiúsculas. O schema valida só o formato. O conflito com a moeda da wallet é `CURRENCY_MISMATCH` (seção 10).
- `MoneySchema` vale em toda entrada e nas saídas que nunca ficam negativas (saldo, ledger). `SignedMoneySchema` só em `difference` da reconciliação.
- Conversão: o caso de uso chama `Money.from(dto)`. A saída usa `money.toJSON()` (`MoneyProps`).

### 8.2 Identificadores

Declarados uma vez em `src/shared/contracts/ids.schema.ts` (`WalletIdSchema`, `ProviderIdSchema`...).

| Campo | Schema | Observação |
| --- | --- | --- |
| IDs internos (`walletId`, `transactionId`, `entryId`, `eventId`, `outbox.id`) | `z.uuid({ version: 'v7' })` | gerados pela API (UUIDv7, ordenável por tempo) |
| `playerId` | `z.uuid()` | vem do provedor/plataforma |
| `providerId` | `z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)` | sem `:`, que é o separador da Idempotency-Key |
| `externalTransactionId`, `referenceExternalTransactionId` | `z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)` | opaco, do provedor |
| `roundId`, `gameId` | `z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)` | opaco, do provedor |
| `messageId` (SQS) | `z.string().min(1).max(128)` | chave da inbox junto com `consumerName` |

### 8.3 Datas, enums e nulos

- Datas: ISO-8601 UTC com milissegundos (`date.toISOString()`), schema `z.iso.datetime()`. Nunca epoch.
- Enums em `UPPER_SNAKE_CASE`, iguais aos do domínio.
- Campo opcional ausente é omitido (sem `null`), exceto `nextCursor: string | null`.
- Campos em `camelCase`. `snake_case` só nas colunas do banco.

```ts
export const SubmittableKindSchema = z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']); // sem OPENING
export const TransactionKindSchema = z.enum(['OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']); // saída
export const TransactionStatusSchema = z.enum(['PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED']);
export const LedgerDirectionSchema = z.enum(['DEBIT', 'CREDIT']);
```

`OPENING` aparece em respostas (transação, ledger) e nunca é aceito em entrada.

## 9. Contratos HTTP

Objetos de entrada com `.strict()`. Os nomes são os `id` do OpenAPI (`.meta({ id })`).

### 9.1 Wallets

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /wallets` | `CreateWalletRequest` | `201 WalletView` |
| `GET /wallets/:walletId` | params `WalletIdParams` | `200 WalletView` |
| `GET /wallets/:walletId/ledger` | params + query `LedgerPageQuery` | `200 LedgerPage` |
| `POST /wallets/:walletId/reconciliation` | params, sem body | `200 ReconciliationReport` |

```ts
CreateWalletRequest  = { playerId: uuid, initialBalance: Money }               // strict
WalletView           = { id, playerId, balance: Money, version: int >= 1, createdAt, updatedAt }
WalletIdParams       = { walletId: uuidv7 }
LedgerPageQuery      = { cursor?: string (opaco), limit: z.coerce.number().int().min(1).max(200).default(50) }
LedgerPage           = { items: LedgerEntryView[], nextCursor: string | null }
LedgerEntryView      = { id, transactionId, direction, money: Money, balanceBefore: Money, balanceAfter: Money, createdAt }
ReconciliationReport = {
  walletId, storedBalance: Money, calculatedBalance: Money,
  difference: SignedMoney, consistent: boolean, checkedEntries: int >= 0, checkedAt
}
```

- A moeda da wallet vem de `initialBalance.currency`. Saldo inicial `"0.00"` é válido: grava a transação `OPENING` `PROCESSED`, sem lançamento, porque o ledger exige `amount > 0` (ESCOLHAS #21).
- `limit` é o único campo numérico de entrada (`z.coerce`, por vir da query string).

### 9.2 Cursor do ledger (ESCOLHAS #18)

- Ordenação `(created_at ASC, id ASC)`. O `id` UUIDv7 desempata.
- Cursor = `base64url(JSON.stringify({ v: 1, createdAt, id }))` do último item. O schema de entrada valida só `z.string().regex(/^[A-Za-z0-9_-]+$/).max(512)`.
- Decodificado no service/repository. Inválido ou `v` desconhecido → `400 REQUEST_VALIDATION_FAILED`, `path: 'cursor'`.
- Busca `limit + 1` linhas. `nextCursor: null` quando não há próxima página.

### 9.3 Wagering

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /wagering/transactions` | header `Idempotency-Key` + `SubmitTransactionRequest` | `SubmitTransactionResponse` (status na seção 11) |
| `GET /wagering/transactions/:transactionId` | params | `200 TransactionView` |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | params | `200 TransactionView` |

```ts
SubmitTransactionRequest = {          // strict; os mesmos campos formam o payloadHash
  providerId, externalTransactionId, playerId, walletId, roundId, gameId,
  kind: SubmittableKind,
  money: Money,
  referenceExternalTransactionId?: string,
}

SubmitTransactionResponse = {
  transactionId: uuidv7,
  status: TransactionStatus,          // PROCESSED | PENDING_REFERENCE (REJECTED sai como erro 422)
  balance: Money,                     // saldo observado ao processar; replay devolve o mesmo valor
  idempotentReplay: boolean,
}

TransactionView = {
  id, providerId, externalTransactionId, idempotencyKey, walletId, playerId, roundId, gameId,
  kind: TransactionKind, money: Money, status: TransactionStatus,
  referenceExternalTransactionId?, referenceTransactionId?, failureCode?,
  createdAt, processedAt?,
}
```

Regras de referência, no schema (`.superRefine`, para responder 400 cedo) e de novo em `WagerTransaction.create`:

- `REFUND` e `ROLLBACK` exigem `referenceExternalTransactionId`.
- `BET` e `LOSS` não aceitam referência (`400`; ESCOLHAS #21). `WIN` aceita opcionalmente.
- Existência, rodada e valor da referência são regras de domínio: viram `failureCode` (seção 10).
- `WIN` com referência que não existe é processado sem ligação (`referenceTransactionId` ausente); se a referência existir, vale a regra 2 da §7 (`REFERENCE_MISMATCH`). `REFUND` e `ROLLBACK` sem referência encontrada vão para `PENDING_REFERENCE`.
- Uma `BET` aceita um único estorno, `REFUND` ou `ROLLBACK`. O `ROLLBACK` de um `REFUND` é aceito, e a `BET` volta a valer, mas não recebe outro `REFUND` (ESCOLHAS #21).

`TransactionView` nunca expõe `payloadHash`.

### 9.4 Idempotency-Key (ESCOLHAS #8)

```ts
export const IdempotencyKeySchema = z
  .string({ error: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9._:-]{1,255}$/)
  .meta({ example: 'provider-a:transaction-123' });

export const SubmitTransactionHeadersSchema = z.object({ 'idempotency-key': IdempotencyKeySchema });
```

- Obrigatório. O controller valida o objeto de headers com `parseOrThrow(SubmitTransactionHeadersSchema, headers)` (sem `.strict()`: os outros headers são ignorados). Falha → `400`, `path: 'idempotency-key'`.
- Formato recomendado `{providerId}:{externalTransactionId}`, mas o header é a fonte da verdade: a API não o recalcula nem o compara com o body.
- O header não entra no `payloadHash`.

### 9.5 payloadHash (ESCOLHAS #17)

Algoritmo único para HTTP e SQS, em `src/shared/contracts/payload-hash.ts`:

1. Entrada: o objeto de negócio já validado (`SubmitTransactionRequest`, ou `data` da mensagem SQS sem `idempotencyKey`).
2. Remove chaves com `undefined`.
3. JSON canônico: chaves ordenadas por code point em todos os níveis, sem espaços.
4. `sha256` do UTF-8 em hex minúsculo, com prefixo de versão: `v1:<hex>`.

```ts
export function payloadHash(payload: SubmitTransactionRequest): string {
  return `v1:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}
```

- `amount` já é canônico pela regex, sem normalização numérica.
- Transporte e metadados (`messageId`, `occurredAt`, `type`, headers, `X-Request-Id`, contexto de trace) nunca entram.
- Mudança de campos ou de algoritmo → prefixo `v2:` e comparação aceitando as duas versões.

### 9.6 Health

`src/modules/health/health.schema.ts`: `Liveness = { status: 'ok' }`, `Readiness = { status: 'ok', checks: { database: 'up', queue: 'up' } }`. O check de fila faz um `GetQueueAttributes` real em cada fila. Falha → `503 DEPENDENCY_UNAVAILABLE` (`details[0].message` = `database` ou `queue`).

### 9.7 Corpo de erro

`ErrorResponse` (`src/shared/http/error-response.schema.ts`), emitido só pelo `ErrorHandler`:

```ts
ErrorResponse = {
  statusCode: int, code: string, message: string,
  details: { path: string, message: string }[],
  correlationId?: string,      // X-Request-Id do nginx, ou gerado pela api quando falta
  path: string, timestamp: string,
  transactionId?: uuidv7,      // só em TransactionRejectedError
}
```

## 10. failureCode (ESCOLHAS #14)

Enum `FailureCode` do domínio, gravado em `wager_transactions.failure_code`, devolvido em `TransactionView.failureCode`, no `code` do erro 422 e no evento `WagerTransactionRejected`.

| failureCode | Status final | Quando | O provedor deve |
| --- | --- | --- | --- |
| `INSUFFICIENT_FUNDS` | REJECTED | `BET` maior que o saldo | desistir |
| `REVERSAL_INSUFFICIENT_FUNDS` | REJECTED | `ROLLBACK` de crédito deixaria saldo negativo | escalar (operacional) |
| `CURRENCY_MISMATCH` | REJECTED | moeda da operação ≠ moeda da wallet | corrigir o payload |
| `WALLET_PLAYER_MISMATCH` | REJECTED | wallet não pertence ao `playerId` | corrigir o payload |
| `REFERENCE_NOT_FOUND` | REJECTED | `PENDING_REFERENCE` esgotou as tentativas | desistir ou reenviar a referência primeiro |
| `REFERENCE_MISMATCH` | REJECTED | referência de outro provider, player, wallet, moeda ou rodada | corrigir o payload |
| `REFERENCE_KIND_NOT_ALLOWED` | REJECTED | `REFUND` sem `BET`, ou `ROLLBACK` de `LOSS`/`ROLLBACK`/`OPENING` | corrigir o payload |
| `REFERENCE_NOT_PROCESSED` | REJECTED | referência existe mas está `REJECTED` ou `FAILED` | desistir |
| `REFERENCE_ALREADY_REVERSED` | REJECTED | a referência já foi estornada: uma `BET` aceita um único `REFUND` ou `ROLLBACK`; as demais, um `ROLLBACK` | desistir (duplicata de negócio) |
| `REVERSAL_AMOUNT_MISMATCH` | REJECTED | valor ≠ valor da referência | corrigir o payload |
| `BET_ALREADY_CANCELLED` | REJECTED | `BET` que chega depois de um `REFUND` rejeitado que a citava (ESCOLHAS #21) | desistir |
| `ROUND_CLOSED` | REJECTED | `BET` numa rodada já fechada por `WIN` ou `LOSS` (ESCOLHAS #21) | desistir |
| `PROCESSING_RETRIES_EXHAUSTED` | FAILED | erro transitório persistiu além do limite (vai para DLQ) | reenviar mais tarde |

`WALLET_NOT_FOUND` **não** é `failureCode`: sem wallet não há transação a persistir (FK `wager_transactions.wallet_id → wallets.id`), então é `404` sem registro (seção 11).

## 11. Status HTTP por resultado (ESCOLHAS #16)

Vale para todos os endpoints. Erros passam pelo `ErrorHandler` (`STATUS_BY_KIND`) com o corpo da seção 9.7.

| Situação | Status | Corpo | `code` |
| --- | --- | --- | --- |
| Transação nova `PROCESSED` | `201` | `SubmitTransactionResponse` | — |
| Aceita, aguardando referência (`PENDING_REFERENCE`) | `202` | `SubmitTransactionResponse` | — |
| Replay idêntico de transação terminal | mesmo status da resposta original | mesmo corpo, `idempotentReplay: true` | — |
| Replay idêntico de transação ainda `PENDING_REFERENCE` | status do estado atual (`202`, ou `201`/`422` se resolvida) | estado atual, `idempotentReplay: true` | — |
| Payload, params, query ou header inválido | `400` | `ErrorResponse` | `REQUEST_VALIDATION_FAILED` |
| Recurso inexistente (GET), ou `walletId` inexistente no submit | `404` | `ErrorResponse` | `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND` |
| Mesma key, payload diferente | `409` | `ErrorResponse` | `IDEMPOTENCY_KEY_CONFLICT` |
| Wallet duplicada (`playerId` + `currency`) | `409` | `ErrorResponse` | `WALLET_ALREADY_EXISTS` |
| Rejeição por regra de negócio (`REJECTED`) | `422` | `ErrorResponse` + `transactionId` | o `failureCode` |
| PostgreSQL/SQS indisponível, retry de lock esgotado | `503` | `ErrorResponse` | `DEPENDENCY_UNAVAILABLE`, `CONCURRENCY_CONFLICT` |
| Erro inesperado | `500` | `ErrorResponse` | `INTERNAL_ERROR` |

- Rejeição é persistida: o replay devolve de novo `422` com o mesmo `failureCode` e `transactionId`.
- `SUBMIT_STATUS_BY_RESULT`: `PROCESSED` → `201`, `PENDING_REFERENCE` → `202`. `PENDING` é interno e não sai na resposta.
- `walletId` inexistente no submit: nada é gravado (transação, ledger, outbox), sem evento. A key não é consumida; reenviar depois de criar a wallet processa normalmente.
- `WALLET_PLAYER_MISMATCH` é `422` persistido: a wallet existe.
- Sem autenticação, não há `403`.

## 12. Mensagens SQS

### 12.1 Entrada: `WagerTransactionRequested`

```ts
export const WagerTransactionRequestedSchema = z
  .object({
    messageId: MessageIdSchema,
    type: z.literal('WagerTransactionRequested'),
    occurredAt: z.iso.datetime(),
    data: SubmitTransactionRequestSchema.extend({ idempotencyKey: IdempotencyKeySchema }).strict(),
  })
  .strict();
```

| Caso | Tratamento | Log | Métrica (`wagering.sqs.messages`) |
| --- | --- | --- | --- |
| Processada (`PROCESSED`, `REJECTED`, `PENDING_REFERENCE`) | ack após o commit | conforme o resultado | `outcome=ack` |
| Duplicata de inbox `(consumerName, messageId)` | ack sem efeito | `debug` | `outcome=ack` + `wagering.inbox.duplicates` |
| `walletId` inexistente | ack, inbox marcada, sem transação nem evento | `warn` | `outcome=ack` |
| Falha transitória | sem ack, volta após o visibility timeout | `warn` | `outcome=retry` |
| Corpo inválido | DLQ | `error`, sem o body | `outcome=dlq`, `reason=invalid_message` |
| Tentativas esgotadas | `FAILED` (`PROCESSING_RETRIES_EXHAUSTED`) + DLQ | `error` | `outcome=dlq`, `reason=retries_exhausted` |

- `data` reusa o schema do body HTTP: o use case recebe o mesmo DTO pelas duas entradas.
- Dedup da inbox por `messageId`; dedup de negócio por `idempotencyKey`. A mesma operação pode chegar com `messageId` diferente.
- `traceparent`, `tracestate`, `baggage` e `correlationId` vão em `MessageAttributes`, nunca no body ([jaeger.md](jaeger.md), seção 6).

## 13. Eventos de integração (outbox)

### 13.1 Envelope

Serializado em `outbox_messages.payload` e publicado como body:

```json
{
  "eventId": "0192f2a0-…",
  "eventType": "WalletBalanceChanged",
  "version": 1,
  "aggregateId": "<walletId ou transactionId>",
  "correlationId": "<X-Request-Id ou messageId de origem>",
  "causationId": "<transactionId ou messageId que causou>",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": { }
}
```

- `aggregateId`: `walletId` em `WalletBalanceChanged`, `transactionId` nos eventos de transação.
- `data` só tem primitivos JSON e `MoneyProps`. Datas como string ISO.
- Publicação at-least-once. O consumidor deduplica por `eventId`.
- Destino: fila `wallet-events.fifo`, com `MessageGroupId = aggregateId` e `MessageDeduplicationId = eventId` (ESCOLHAS #28).

### 13.2 `data` de cada evento (version 1)

| Evento | Quando |
| --- | --- |
| `WagerTransactionProcessed` | qualquer transação aplicada, inclusive `LOSS` |
| `WagerTransactionRejected` | transação `REJECTED` |
| `WagerTransactionPendingReference` | referência ausente |
| `WalletBalanceChanged` | só quando há lançamento no ledger (inclusive `OPENING`) |

```ts
interface WagerTransactionEventBase {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

interface WagerTransactionProcessedData extends WagerTransactionEventBase {
  referenceTransactionId?: string;
  balanceAfter: MoneyProps;      // em LOSS, igual ao saldo do momento
  processedAt: string;
}

interface WagerTransactionRejectedData extends WagerTransactionEventBase {
  failureCode: FailureCode;
  rejectedAt: string;
}

interface WagerTransactionPendingReferenceData extends WagerTransactionEventBase {
  referenceExternalTransactionId: string;
  attempts: number;
  nextAttemptAt: string;
}

interface WalletBalanceChangedData {   // igual ao enunciado
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}
```
