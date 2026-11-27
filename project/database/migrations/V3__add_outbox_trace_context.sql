-- V3: contexto de trace W3C gravado com o evento, para o publisher ligar o span PRODUCER ao request de origem (jaeger.md §6).
-- Coluna nullable: eventos antigos e os gravados sem trace ativo ficam sem link.
ALTER TABLE outbox_messages
    ADD COLUMN trace_context jsonb;

-- Quando presente, é um objeto de propagação (traceparent, tracestate, baggage).
ALTER TABLE outbox_messages
    ADD CONSTRAINT ck_outbox_messages_trace_context
    CHECK (trace_context IS NULL OR jsonb_typeof(trace_context) = 'object');
