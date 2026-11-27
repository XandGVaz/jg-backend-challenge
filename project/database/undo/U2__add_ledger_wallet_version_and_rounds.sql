-- Reverte V2__add_ledger_wallet_version_and_rounds.sql na ordem inversa: dependentes antes das colunas.
-- Os triggers de rounds caem junto com a tabela; as funções do R__rounds_guard só serviam a ela.

-- 3) Uma reversão por BET.
DROP INDEX uq_wager_transactions_bet_reversal_once;

ALTER TABLE wager_transactions DROP CONSTRAINT fk_wager_transactions_reference_kind;
ALTER TABLE wager_transactions DROP CONSTRAINT uq_wager_transactions_id_kind;
ALTER TABLE wager_transactions DROP CONSTRAINT ck_wager_transactions_reference_kind;
ALTER TABLE wager_transactions DROP COLUMN reference_kind;

-- 2) Rodadas.
DROP TABLE rounds;
DROP FUNCTION IF EXISTS guard_round_update();
DROP FUNCTION IF EXISTS forbid_round_delete();

-- 1) Versão da wallet no ledger.
ALTER TABLE wallet_ledger_entries DROP CONSTRAINT ck_wallet_ledger_entries_wallet_version;
ALTER TABLE wallet_ledger_entries DROP CONSTRAINT uq_wallet_ledger_entries_wallet_version;
ALTER TABLE wallet_ledger_entries DROP COLUMN wallet_version;
