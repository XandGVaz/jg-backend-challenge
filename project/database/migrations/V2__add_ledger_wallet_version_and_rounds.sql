-- V2: versão da wallet no ledger, tabela rounds e uma reversão por BET (ESCOLHAS #12 e #21).
-- Colunas novas em tabelas com dados entram nullable, recebem backfill e só então ficam NOT NULL.
-- Guardas de rodada ficam em R__rounds_guard.sql; nenhum objeto aqui depende de um R__.

-- 1) Versão da wallet resultante de cada lançamento: dois lançamentos nunca saem da mesma versão (ESCOLHAS #12).
ALTER TABLE wallet_ledger_entries
    ADD COLUMN wallet_version integer;

-- O trigger append-only barraria o backfill: desabilita os triggers de usuário da tabela e reabilita em seguida.
ALTER TABLE wallet_ledger_entries DISABLE TRIGGER USER;

-- Wallet aberta com saldo 0 não gera lançamento e a versão 1 fica sem entrada: a sequência começa em 2.
WITH entry_ordinals AS (
    SELECT
        l.id,
        l.wallet_id,
        l.transaction_id,
        row_number() OVER (PARTITION BY l.wallet_id ORDER BY l.created_at, l.id) AS ordinal
    FROM wallet_ledger_entries l
),
wallet_version_offsets AS (
    SELECT
        eo.wallet_id,
        CASE WHEN t.kind = 'OPENING' THEN 0 ELSE 1 END AS version_offset
    FROM entry_ordinals eo
    JOIN wager_transactions t ON t.id = eo.transaction_id AND t.wallet_id = eo.wallet_id
    WHERE eo.ordinal = 1
)
UPDATE wallet_ledger_entries e
SET wallet_version = eo.ordinal + wvo.version_offset
FROM entry_ordinals eo
JOIN wallet_version_offsets wvo ON wvo.wallet_id = eo.wallet_id
WHERE e.id = eo.id;

ALTER TABLE wallet_ledger_entries ENABLE TRIGGER USER;

ALTER TABLE wallet_ledger_entries
    ALTER COLUMN wallet_version SET NOT NULL;

ALTER TABLE wallet_ledger_entries
    ADD CONSTRAINT uq_wallet_ledger_entries_wallet_version UNIQUE (wallet_id, wallet_version);

-- CHECK novo em tabela com dados: entra NOT VALID e é validado em seguida, sem reescrever a tabela.
ALTER TABLE wallet_ledger_entries
    ADD CONSTRAINT ck_wallet_ledger_entries_wallet_version CHECK (wallet_version >= 1) NOT VALID;
ALTER TABLE wallet_ledger_entries
    VALIDATE CONSTRAINT ck_wallet_ledger_entries_wallet_version;

-- 2) Rodadas: uma por provedor, abertas ou fechadas; o primeiro WIN ou LOSS fecha (ESCOLHAS #21).
-- Sem FK de wager_transactions: OPENING não tem rodada real; imutabilidade fica em R__rounds_guard.sql.
CREATE TABLE rounds (
    provider_id   varchar(64)     NOT NULL,
    round_id      varchar(128)    NOT NULL,
    status        varchar(10)     NOT NULL,
    opened_at     timestamptz(3)  NOT NULL,
    closed_at     timestamptz(3),
    CONSTRAINT pk_rounds           PRIMARY KEY (provider_id, round_id),
    CONSTRAINT ck_rounds_status     CHECK (status IN ('OPEN', 'CLOSED')),
    -- Fechada tem closed_at; aberta não tem.
    CONSTRAINT ck_rounds_closed     CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
    CONSTRAINT ck_rounds_timestamps CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- 3) Uma reversão por BET, qualquer que seja o tipo; o índice por tipo segue valendo para os demais kinds (ESCOLHAS #21).
ALTER TABLE wager_transactions
    ADD COLUMN reference_kind varchar(16);

-- O guard barraria o backfill de linhas terminais: desabilita os triggers de usuário da tabela e reabilita em seguida.
ALTER TABLE wager_transactions DISABLE TRIGGER USER;

-- Backfill: reference_kind é o kind da transação referenciada; o app grava o par junto ao resolver a referência.
UPDATE wager_transactions t
SET reference_kind = ref.kind
FROM wager_transactions ref
WHERE t.reference_transaction_id = ref.id;

ALTER TABLE wager_transactions ENABLE TRIGGER USER;

-- O par entra e sai junto; depois do backfill nenhuma linha fica com um lado só.
ALTER TABLE wager_transactions
    ADD CONSTRAINT ck_wager_transactions_reference_kind
    CHECK ((reference_transaction_id IS NULL) = (reference_kind IS NULL)) NOT VALID;
ALTER TABLE wager_transactions
    VALIDATE CONSTRAINT ck_wager_transactions_reference_kind;

-- (id, kind) referenciável: a FK composta obriga reference_kind a ser o kind da transação referenciada.
ALTER TABLE wager_transactions
    ADD CONSTRAINT uq_wager_transactions_id_kind UNIQUE (id, kind);

ALTER TABLE wager_transactions
    ADD CONSTRAINT fk_wager_transactions_reference_kind
    FOREIGN KEY (reference_transaction_id, reference_kind)
    REFERENCES wager_transactions (id, kind);

-- Uma BET só é estornada uma vez, por REFUND ou por ROLLBACK (o uq_wager_transactions_reversal_once cobre os demais kinds).
CREATE UNIQUE INDEX uq_wager_transactions_bet_reversal_once
    ON wager_transactions (reference_transaction_id)
    WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED' AND reference_kind = 'BET';
