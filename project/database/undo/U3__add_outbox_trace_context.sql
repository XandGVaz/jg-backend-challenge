-- Reverte V3__add_outbox_trace_context.sql.
ALTER TABLE outbox_messages DROP CONSTRAINT ck_outbox_messages_trace_context;
ALTER TABLE outbox_messages DROP COLUMN trace_context;
