-- Schema completo: wallets, transações de aposta, rodadas, ledger, inbox e outbox.
-- Garantias de unicidade, imutabilidade e não-negatividade ficam aqui (REQUISITOS §5.9).
-- Triggers: R__ledger_entries_immutable.sql, R__wager_transactions_guard.sql e R__rounds_guard.sql.

CREATE TABLE wallets (
    id              uuid            NOT NULL,
    player_id       uuid            NOT NULL,
    currency        char(3)         NOT NULL,
    balance_amount  numeric(20, 2)  NOT NULL,
    version         integer         NOT NULL,
    created_at      timestamptz(3)  NOT NULL,
    updated_at      timestamptz(3)  NOT NULL,
    CONSTRAINT pk_wallets                   PRIMARY KEY (id),
    CONSTRAINT uq_wallets_player_currency   UNIQUE (player_id, currency),
    CONSTRAINT uq_wallets_id_currency       UNIQUE (id, currency),
    CONSTRAINT ck_wallets_currency          CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_wallets_balance           CHECK (balance_amount >= 0),
    CONSTRAINT ck_wallets_version           CHECK (version >= 1),
    CONSTRAINT ck_wallets_timestamps        CHECK (updated_at >= created_at)
);

CREATE TABLE wager_transactions (
    id                                  uuid            NOT NULL,
    provider_id                         varchar(64)     NOT NULL,
    external_transaction_id             varchar(128)    NOT NULL,
    idempotency_key                     varchar(255)    NOT NULL,
    payload_hash                        varchar(80)     NOT NULL,
    wallet_id                           uuid            NOT NULL,
    player_id                           uuid            NOT NULL,
    round_id                            varchar(128)    NOT NULL,
    game_id                             varchar(128)    NOT NULL,
    kind                                varchar(16)     NOT NULL,
    amount                              numeric(20, 2)  NOT NULL,
    currency                            char(3)         NOT NULL,
    reference_external_transaction_id   varchar(128),
    reference_transaction_id            uuid,
    -- Kind da referência, gravado junto com reference_transaction_id: sustenta um estorno por BET (ESCOLHAS #21).
    reference_kind                      varchar(16),
    status                              varchar(20)     NOT NULL,
    failure_code                        varchar(64),
    -- Saldo observado ao processar/rejeitar: o replay devolve este valor (REQUISITOS §7.7).
    result_balance_amount               numeric(20, 2),
    result_balance_currency             char(3),
    reference_attempts                  integer         NOT NULL DEFAULT 0,
    next_reference_attempt_at           timestamptz(3),
    created_at                          timestamptz(3)  NOT NULL,
    updated_at                          timestamptz(3)  NOT NULL,
    processed_at                        timestamptz(3),
    CONSTRAINT pk_wager_transactions                PRIMARY KEY (id),
    CONSTRAINT uq_wager_transactions_idempotency    UNIQUE (idempotency_key),
    CONSTRAINT uq_wager_transactions_external       UNIQUE (provider_id, external_transaction_id),
    CONSTRAINT uq_wager_transactions_id_wallet      UNIQUE (id, wallet_id),
    CONSTRAINT uq_wager_transactions_id_kind        UNIQUE (id, kind),
    CONSTRAINT fk_wager_transactions_wallet         FOREIGN KEY (wallet_id) REFERENCES wallets (id),
    CONSTRAINT fk_wager_transactions_reference      FOREIGN KEY (reference_transaction_id) REFERENCES wager_transactions (id),
    -- A FK composta obriga reference_kind a ser o kind real da transação referenciada.
    CONSTRAINT fk_wager_transactions_reference_kind FOREIGN KEY (reference_transaction_id, reference_kind) REFERENCES wager_transactions (id, kind),
    CONSTRAINT ck_wager_transactions_reference_kind CHECK ((reference_transaction_id IS NULL) = (reference_kind IS NULL)),
    CONSTRAINT ck_wager_transactions_kind           CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
    CONSTRAINT ck_wager_transactions_status         CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
    CONSTRAINT ck_wager_transactions_amount         CHECK (amount >= 0),
    CONSTRAINT ck_wager_transactions_currency       CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_wager_transactions_payload_hash   CHECK (payload_hash ~ '^v[0-9]+:[0-9a-f]{64}$'),
    CONSTRAINT ck_wager_transactions_failure_code   CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT ck_wager_transactions_attempts       CHECK (reference_attempts >= 0),
    CONSTRAINT ck_wager_transactions_self_reference CHECK (reference_transaction_id IS DISTINCT FROM id),
    -- REFUND e ROLLBACK exigem referência; BET, LOSS e OPENING não aceitam; WIN é opcional.
    CONSTRAINT ck_wager_transactions_reference_required
        CHECK (kind NOT IN ('REFUND', 'ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
    CONSTRAINT ck_wager_transactions_reference_forbidden
        CHECK (kind NOT IN ('BET', 'LOSS', 'OPENING') OR reference_external_transaction_id IS NULL),
    -- Coerência entre status e campos de resultado.
    CONSTRAINT ck_wager_transactions_processed
        CHECK (status <> 'PROCESSED' OR (processed_at IS NOT NULL AND failure_code IS NULL)),
    CONSTRAINT ck_wager_transactions_failed
        CHECK (status NOT IN ('REJECTED', 'FAILED') OR failure_code IS NOT NULL),
    CONSTRAINT ck_wager_transactions_open
        CHECK (status NOT IN ('PENDING', 'PENDING_REFERENCE') OR (failure_code IS NULL AND processed_at IS NULL)),
    CONSTRAINT ck_wager_transactions_result_balance
        CHECK ((result_balance_amount IS NULL) = (result_balance_currency IS NULL) AND (result_balance_amount IS NULL OR result_balance_amount >= 0))
);

-- Uma referência só é revertida uma vez por tipo de operação (REQUISITOS §7.4).
CREATE UNIQUE INDEX uq_wager_transactions_reversal_once
    ON wager_transactions (reference_transaction_id, kind)
    WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED';

-- Uma BET só é estornada uma vez, por REFUND ou por ROLLBACK (ESCOLHAS #21).
CREATE UNIQUE INDEX uq_wager_transactions_bet_reversal_once
    ON wager_transactions (reference_transaction_id)
    WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED' AND reference_kind = 'BET';

-- Resolução da referência por (provider, id externo) e worker de PENDING_REFERENCE.
CREATE INDEX ix_wager_transactions_reference_lookup
    ON wager_transactions (provider_id, reference_external_transaction_id)
    WHERE reference_external_transaction_id IS NOT NULL;

CREATE INDEX ix_wager_transactions_pending_reference
    ON wager_transactions (next_reference_attempt_at)
    WHERE status = 'PENDING_REFERENCE';

CREATE INDEX ix_wager_transactions_wallet ON wager_transactions (wallet_id, created_at);

CREATE TABLE wallet_ledger_entries (
    id                      uuid            NOT NULL,
    wallet_id               uuid            NOT NULL,
    transaction_id          uuid            NOT NULL,
    direction               varchar(6)      NOT NULL,
    amount                  numeric(20, 2)  NOT NULL,
    currency                char(3)         NOT NULL,
    balance_before_amount   numeric(20, 2)  NOT NULL,
    balance_after_amount    numeric(20, 2)  NOT NULL,
    -- Versão da wallet depois deste lançamento: dois lançamentos nunca saem da mesma versão (ESCOLHAS #12).
    wallet_version          integer         NOT NULL,
    created_at              timestamptz(3)  NOT NULL,
    CONSTRAINT pk_wallet_ledger_entries                 PRIMARY KEY (id),
    -- No máximo um lançamento por wallet em cada transação (REQUISITOS §6.4).
    CONSTRAINT uq_wallet_ledger_entries_transaction     UNIQUE (wallet_id, transaction_id),
    CONSTRAINT uq_wallet_ledger_entries_wallet_version  UNIQUE (wallet_id, wallet_version),
    CONSTRAINT ck_wallet_ledger_entries_wallet_version  CHECK (wallet_version >= 1),
    -- A moeda do lançamento é a da wallet; a transação pertence à mesma wallet.
    CONSTRAINT fk_wallet_ledger_entries_wallet          FOREIGN KEY (wallet_id, currency) REFERENCES wallets (id, currency),
    CONSTRAINT fk_wallet_ledger_entries_transaction     FOREIGN KEY (transaction_id, wallet_id) REFERENCES wager_transactions (id, wallet_id),
    CONSTRAINT ck_wallet_ledger_entries_direction       CHECK (direction IN ('DEBIT', 'CREDIT')),
    CONSTRAINT ck_wallet_ledger_entries_amount          CHECK (amount > 0),
    CONSTRAINT ck_wallet_ledger_entries_balances        CHECK (balance_before_amount >= 0 AND balance_after_amount >= 0),
    CONSTRAINT ck_wallet_ledger_entries_arithmetic      CHECK (
        (direction = 'CREDIT' AND balance_after_amount = balance_before_amount + amount)
        OR (direction = 'DEBIT' AND balance_after_amount = balance_before_amount - amount)
    )
);

-- Paginação por cursor (created_at, id) e reconstrução do saldo pela ordem do ledger.
CREATE INDEX ix_wallet_ledger_entries_cursor ON wallet_ledger_entries (wallet_id, created_at, id);

CREATE TABLE inbox_messages (
    consumer_name   varchar(64)     NOT NULL,
    message_id      varchar(128)    NOT NULL,
    payload_hash    varchar(80)     NOT NULL,
    received_at     timestamptz(3)  NOT NULL,
    processed_at    timestamptz(3),
    CONSTRAINT pk_inbox_messages            PRIMARY KEY (consumer_name, message_id),
    CONSTRAINT ck_inbox_messages_processed  CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE TABLE outbox_messages (
    id              uuid            NOT NULL,
    aggregate_id    uuid            NOT NULL,
    event_type      varchar(100)    NOT NULL,
    event_version   integer         NOT NULL,
    payload         jsonb           NOT NULL,
    occurred_at     timestamptz(3)  NOT NULL,
    attempts        integer         NOT NULL DEFAULT 0,
    next_attempt_at timestamptz(3),
    published_at    timestamptz(3),
    -- Contexto W3C do request de origem, para o publisher ligar o span PRODUCER (jaeger.md §6).
    trace_context   jsonb,
    CONSTRAINT pk_outbox_messages           PRIMARY KEY (id),
    CONSTRAINT ck_outbox_messages_version   CHECK (event_version >= 1),
    CONSTRAINT ck_outbox_messages_attempts  CHECK (attempts >= 0),
    CONSTRAINT ck_outbox_messages_payload   CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT ck_outbox_messages_trace_context CHECK (trace_context IS NULL OR jsonb_typeof(trace_context) = 'object')
);

-- Publishers concorrentes buscam pendentes com FOR UPDATE SKIP LOCKED nesta ordem.
CREATE INDEX ix_outbox_messages_pending
    ON outbox_messages (next_attempt_at, occurred_at)
    WHERE published_at IS NULL;

-- Rodadas: uma por provedor, abertas ou fechadas; o primeiro WIN ou LOSS fecha (ESCOLHAS #21).
-- Sem FK de wager_transactions: OPENING não tem rodada real; imutabilidade fica em R__rounds_guard.sql.
CREATE TABLE rounds (
    provider_id   varchar(64)     NOT NULL,
    round_id      varchar(128)    NOT NULL,
    status        varchar(10)     NOT NULL,
    opened_at     timestamptz(3)  NOT NULL,
    closed_at     timestamptz(3),
    CONSTRAINT pk_rounds            PRIMARY KEY (provider_id, round_id),
    CONSTRAINT ck_rounds_status     CHECK (status IN ('OPEN', 'CLOSED')),
    -- Fechada tem closed_at; aberta não tem.
    CONSTRAINT ck_rounds_closed     CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CONSTRAINT ck_rounds_timestamps CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
