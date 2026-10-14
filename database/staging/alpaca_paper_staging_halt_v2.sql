-- SportsEdge Staging-only safety lockdown. NO Production permission.
-- Depends on staging v1 migration 20261014194253 alpaca_paper_staging_outbox_v1.
-- This deliberately has NO resume/unhalt API or client grants.
BEGIN;
CREATE TABLE IF NOT EXISTS sportsedge_private.alpaca_paper_halt_audit(
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_alias text NOT NULL CHECK(length(account_alias) BETWEEN 1 AND 128),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 128),
 actor_role text NOT NULL DEFAULT current_user CHECK(length(actor_role) BETWEEN 1 AND 128)
);
ALTER TABLE sportsedge_private.alpaca_paper_halt_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE sportsedge_private.alpaca_paper_halt_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sportsedge_private.alpaca_paper_halt_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE sportsedge_private.alpaca_paper_halt_audit_audit_id_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sportsedge_private.paper_require_halted()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.halted IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'PAPER_RESTART_NOT_AUTHORIZED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paper_gate_must_remain_halted
BEFORE INSERT OR UPDATE ON sportsedge_private.alpaca_paper_execution_gate
FOR EACH ROW EXECUTE FUNCTION sportsedge_private.paper_require_halted();

CREATE FUNCTION sportsedge_private.paper_halt_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'PAPER_STOP_AUDIT_IMMUTABLE';
END $$;
CREATE TRIGGER paper_halt_audit_no_change
BEFORE UPDATE OR DELETE ON sportsedge_private.alpaca_paper_halt_audit
FOR EACH ROW EXECUTE FUNCTION sportsedge_private.paper_halt_audit_immutable();

-- Server-side operator-only. A missing gate is treated halted everywhere.
-- Repeated stop requests are idempotent as to gate state, but audited.
-- Never returns a capability allowing paper orders, even in staging.
CREATE FUNCTION sportsedge_private.paper_force_halt(
 p_account text, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_account IS NULL OR length(p_account) NOT BETWEEN 1 AND 128 OR
    p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'PAPER_STOP_INPUT_INVALID';
 END IF;
 INSERT INTO sportsedge_private.alpaca_paper_execution_gate(
  account_alias,halted,halt_reason,updated_at)
 VALUES(p_account,true,p_reason,clock_timestamp())
 ON CONFLICT(account_alias) DO UPDATE SET
  halted=true,halt_reason=EXCLUDED.halt_reason,updated_at=clock_timestamp();
 INSERT INTO sportsedge_private.alpaca_paper_halt_audit(account_alias,reason)
 VALUES(p_account,p_reason);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION sportsedge_private.paper_force_halt(text,text)
FROM PUBLIC, anon, authenticated;
-- Staging remains hard-halted; even an elevated writer cannot flip halted=false
-- without a separately reviewed migration removing the safety trigger.
COMMIT;
