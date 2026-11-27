-- Reverte V1__initial_schema.sql. Os triggers caem junto com as tabelas; as funções dos R__ são removidas aqui.
DROP TABLE rounds;
DROP TABLE outbox_messages;
DROP TABLE inbox_messages;
DROP TABLE wallet_ledger_entries;
DROP TABLE wager_transactions;
DROP TABLE wallets;

DROP FUNCTION IF EXISTS forbid_ledger_mutation();
DROP FUNCTION IF EXISTS guard_wager_transaction_update();
DROP FUNCTION IF EXISTS forbid_wager_transaction_delete();
DROP FUNCTION IF EXISTS guard_round_update();
DROP FUNCTION IF EXISTS forbid_round_delete();
