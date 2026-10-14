-- DRAFT ONLY: transactional paper-outbox controls for disposable PostgreSQL tests.
-- DEPENDENCY: alpaca_paper_outbox_PROPOSAL_20261014.sql.
-- DO NOT APPLY THIS DDL OR BASE PROPOSAL TO PRODUCTION.
-- No runtime service uses these functions. Future writers require a separate
-- threat review, least-privilege database role, identity/approval verification,
-- and explicit owner authorization before deployment.
BEGIN;
CREATE TABLE sportsedge_private.alpaca_paper_execution_gate (
  account_alias text PRIMARY KEY CHECK (length(account_alias) BETWEEN 1 AND 128),
  halted boolean NOT NULL DEFAULT true,
  halt_reason text NOT NULL DEFAULT 'UNRELEASED' CHECK (length(halt_reason) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sportsedge_private.alpaca_paper_execution_gate ENABLE ROW LEVEL SECURITY;
ALTER TABLE sportsedge_private.alpaca_paper_execution_gate FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sportsedge_private.alpaca_paper_execution_gate FROM PUBLIC, anon, authenticated;

CREATE TABLE sportsedge_private.alpaca_paper_receipt_events (
  intent_id text NOT NULL REFERENCES sportsedge_private.alpaca_paper_order_outbox(intent_id),
  receipt_version integer NOT NULL CHECK(receipt_version > 0),
  previous_state text NOT NULL,
  next_state text NOT NULL,
  observed_at timestamptz NOT NULL,
  broker_order_id text,
  owner_approval_ref text,
  PRIMARY KEY (intent_id,receipt_version)
);
ALTER TABLE sportsedge_private.alpaca_paper_receipt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sportsedge_private.alpaca_paper_receipt_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sportsedge_private.alpaca_paper_receipt_events FROM PUBLIC, anon, authenticated;

-- Forbid edits to immutable order economics via direct UPDATE, even from a
-- future mistaken elevated service client. A separate privileged rotation/
-- support migration would be needed to change underlying source fields.
CREATE FUNCTION sportsedge_private.paper_protect_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR
    OLD.account_alias IS DISTINCT FROM NEW.account_alias OR
    OLD.signal_id IS DISTINCT FROM NEW.signal_id OR
    OLD.signal_digest IS DISTINCT FROM NEW.signal_digest OR
    OLD.model_version IS DISTINCT FROM NEW.model_version OR
    OLD.client_order_id IS DISTINCT FROM NEW.client_order_id OR
    OLD.symbol IS DISTINCT FROM NEW.symbol OR
    OLD.shares IS DISTINCT FROM NEW.shares OR
    OLD.limit_cents IS DISTINCT FROM NEW.limit_cents OR
    OLD.created_at IS DISTINCT FROM NEW.created_at THEN
   RAISE EXCEPTION 'PAPER_IMMUTABLE_INTENT';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paper_intent_immutable BEFORE UPDATE
ON sportsedge_private.alpaca_paper_order_outbox
FOR EACH ROW EXECUTE FUNCTION sportsedge_private.paper_protect_intent();

-- Database CAS is atomic under row locks; competing callers cannot both use
-- the same expected version. False = conflict/not found, never "retry broker".
-- SECURITY INVOKER + no frontend grants: this is not a published public RPC.
CREATE FUNCTION sportsedge_private.paper_advance_receipt(
 p_intent text, p_expected_version integer, p_next text,
 p_event_time timestamptz, p_owner_ref text DEFAULT NULL,
 p_broker_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE old_row sportsedge_private.alpaca_paper_order_outbox%ROWTYPE;
DECLARE gate_halted boolean;
BEGIN
 SELECT * INTO old_row
 FROM sportsedge_private.alpaca_paper_order_outbox
 WHERE intent_id=p_intent FOR UPDATE;
 IF NOT FOUND OR old_row.lock_version<>p_expected_version THEN
  RETURN false;
 END IF;
 IF p_event_time<old_row.updated_at OR p_event_time>clock_timestamp()+interval '30 seconds' THEN
  RAISE EXCEPTION 'PAPER_EVENT_CLOCK_INVALID';
 END IF;
 IF NOT (
  (old_row.status='planned' AND p_next IN ('owner_approved','stopped')) OR
  (old_row.status='owner_approved' AND p_next IN ('submitting','stopped')) OR
  (old_row.status='submitting' AND p_next IN ('broker_acknowledged','submission_uncertain')) OR
  (old_row.status='broker_acknowledged' AND p_next IN ('broker_filled','broker_rejected','broker_canceled','submission_uncertain')) OR
  (old_row.status='submission_uncertain' AND p_next IN ('broker_acknowledged','broker_rejected'))
 ) THEN
  RAISE EXCEPTION 'PAPER_ILLEGAL_RECEIPT_TRANSITION';
 END IF;
 IF old_row.status='planned' AND p_next='owner_approved' THEN
  IF p_owner_ref IS NULL OR length(p_owner_ref) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'PAPER_APPROVAL_REF_REQUIRED';
  END IF;
 ELSIF p_owner_ref IS NOT NULL AND p_owner_ref IS DISTINCT FROM old_row.owner_approval_ref THEN
  RAISE EXCEPTION 'PAPER_OWNER_IDENTITY_MISMATCH';
 END IF;
 IF p_next='broker_acknowledged' AND
    (p_broker_id IS NULL OR length(p_broker_id) NOT BETWEEN 1 AND 128) THEN
  RAISE EXCEPTION 'PAPER_BROKER_ID_REQUIRED';
 END IF;
 IF old_row.broker_order_id IS NOT NULL AND p_broker_id IS NOT NULL AND
    old_row.broker_order_id IS DISTINCT FROM p_broker_id THEN
  RAISE EXCEPTION 'PAPER_BROKER_ID_MISMATCH';
 END IF;
 -- A missing gate is halted by default; only a separately authorized staging
 -- operator could unhalt this, which this PR intentionally never implements.
 SELECT halted INTO gate_halted
 FROM sportsedge_private.alpaca_paper_execution_gate
 WHERE account_alias=old_row.account_alias FOR SHARE;
 IF p_next IN ('owner_approved','submitting') AND coalesce(gate_halted,true) THEN
  RAISE EXCEPTION 'PAPER_EXECUTION_GATE_CLOSED';
 END IF;
 UPDATE sportsedge_private.alpaca_paper_order_outbox
 SET status=p_next,lock_version=lock_version+1,
  owner_approval_ref=CASE WHEN p_next='owner_approved' THEN p_owner_ref ELSE owner_approval_ref END,
  broker_order_id=coalesce(p_broker_id,broker_order_id),
  updated_at=p_event_time
 WHERE intent_id=p_intent AND lock_version=p_expected_version;
 IF NOT FOUND THEN
  RETURN false;
 END IF;
 INSERT INTO sportsedge_private.alpaca_paper_receipt_events
 (intent_id,receipt_version,previous_state,next_state,observed_at,broker_order_id,owner_approval_ref)
 VALUES(p_intent,p_expected_version+1,old_row.status,p_next,p_event_time,
  coalesce(p_broker_id,old_row.broker_order_id),coalesce(p_owner_ref,old_row.owner_approval_ref));
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION sportsedge_private.paper_advance_receipt(
 text,integer,text,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
COMMIT;
