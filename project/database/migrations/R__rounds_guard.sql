-- Rodada fechada não reabre, identidade e abertura são imutáveis e rodada não é apagada (ESCOLHAS #21).
CREATE OR REPLACE FUNCTION guard_round_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- CLOSED é estado final: o primeiro WIN ou LOSS fecha a rodada para sempre.
    IF OLD.status = 'CLOSED' AND NEW.status = 'OPEN' THEN
        RAISE EXCEPTION 'round %/% is closed and cannot reopen', OLD.provider_id, OLD.round_id
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF (NEW.provider_id, NEW.round_id, NEW.opened_at)
        IS DISTINCT FROM
       (OLD.provider_id, OLD.round_id, OLD.opened_at) THEN
        RAISE EXCEPTION 'identity and opened_at of round %/% are immutable', OLD.provider_id, OLD.round_id
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION forbid_round_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'rounds are game state and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE TRIGGER trg_rounds_guard_update
    BEFORE UPDATE ON rounds
    FOR EACH ROW EXECUTE FUNCTION guard_round_update();

CREATE OR REPLACE TRIGGER trg_rounds_no_delete
    BEFORE DELETE ON rounds
    FOR EACH ROW EXECUTE FUNCTION forbid_round_delete();
