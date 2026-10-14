\set ON_ERROR_STOP on
-- Run ONLY on disposable PG17 service with roles anon and authenticated created.
-- No Supabase project, credentials, market data, or broker calls.
INSERT INTO sportsedge_private.alpaca_paper_order_outbox
 (intent_id,account_alias,signal_id,signal_digest,model_version,client_order_id,symbol,shares,limit_cents)
 VALUES
 ('preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','isolated-paper','signal-A',repeat('a',64),
  'model-v1','se_paper_A','AAPL',2,2500),
 ('preview-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','isolated-paper','signal-B',repeat('b',64),
  'model-v1','se_paper_B','MSFT',2,2600);
DO $$
DECLARE r boolean;
BEGIN
 IF has_table_privilege('anon','sportsedge_private.alpaca_paper_order_outbox','SELECT') OR
    has_table_privilege('authenticated','sportsedge_private.alpaca_paper_order_outbox','INSERT') OR
    has_table_privilege('anon','sportsedge_private.alpaca_paper_receipt_events','SELECT') OR
    has_schema_privilege('anon','sportsedge_private','USAGE') THEN
  RAISE EXCEPTION 'PUBLIC_ROLE_ACCESS_NOT_DENIED';
 END IF;
 -- Missing execution gate defaults CLOSED. No code can start approval.
 BEGIN
  SELECT sportsedge_private.paper_advance_receipt(
   'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,'owner_approved',clock_timestamp(),'owner-A')
   INTO r;
  RAISE EXCEPTION 'MISSING_GATE_SHOULD_DENY';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='MISSING_GATE_SHOULD_DENY' THEN RAISE; END IF;
 END;
 IF (SELECT lock_version FROM sportsedge_private.alpaca_paper_order_outbox
     WHERE signal_id='signal-A')<>0 THEN
  RAISE EXCEPTION 'BLOCKED_TRANSITION_MUST_NOT_UPDATE';
 END IF;
END $$;
-- In the ISOLATED disposable PostgreSQL database only, simulate a future
-- independent operator setting an explicit paper gate to OFF=false.
INSERT INTO sportsedge_private.alpaca_paper_execution_gate
 (account_alias,halted,halt_reason)
 VALUES('isolated-paper',false,'DISPOSABLE_CI_TEST_ONLY');
DO $$
DECLARE ok boolean;
BEGIN
 SELECT sportsedge_private.paper_advance_receipt(
   'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,'owner_approved',clock_timestamp(),'owner-A')
 INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'FIRST_APPROVAL_FAILED'; END IF;
 -- Pending/uncertain intent locks a second approval, even different symbol.
 BEGIN
  SELECT sportsedge_private.paper_advance_receipt(
    'preview-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',0,'owner_approved',clock_timestamp(),'owner-B')
    INTO ok;
  RAISE EXCEPTION 'SECOND_ACTIVE_INTENT_SHOULD_DENY';
 EXCEPTION WHEN unique_violation THEN
  NULL;
 END;
 IF (SELECT lock_version FROM sportsedge_private.alpaca_paper_order_outbox WHERE signal_id='signal-B')<>0 THEN
  RAISE EXCEPTION 'FAILED_SECOND_INTENT_PERSISTED';
 END IF;
 SELECT sportsedge_private.paper_advance_receipt(
   'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'submitting',clock_timestamp(),'owner-A')
 INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'SUBMISSION_TRANSITION_FAILED'; END IF;
 SELECT sportsedge_private.paper_advance_receipt(
   'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2,'submission_uncertain',clock_timestamp(),'owner-A')
 INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'UNCERTAIN_LOCK_TRANSITION_FAILED'; END IF;
 IF (SELECT status FROM sportsedge_private.alpaca_paper_order_outbox WHERE signal_id='signal-A')<>'submission_uncertain' THEN
  RAISE EXCEPTION 'UNCERTAIN_STATE_MISSING';
 END IF;
 -- No direct skip to filled, no unknown-to-submitting rerun.
 BEGIN
  SELECT sportsedge_private.paper_advance_receipt(
   'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',3,'broker_filled',clock_timestamp(),'owner-A')
  INTO ok;
  RAISE EXCEPTION 'UNSAFE_SKIP_SHOULD_DENY';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='UNSAFE_SKIP_SHOULD_DENY' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_receipt_events WHERE intent_id=
      'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')<>3 THEN
  RAISE EXCEPTION 'AUDIT_TRAIL_MISSING';
 END IF;
END $$;
SELECT sportsedge_private.paper_advance_receipt(
 'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',3,'broker_acknowledged',clock_timestamp(),'owner-A','alpaca_mock_order_A');
SELECT sportsedge_private.paper_advance_receipt(
 'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',4,'broker_filled',clock_timestamp(),'owner-A','alpaca_mock_order_A');
DO $$
DECLARE ok boolean;
BEGIN
 -- Stale version never returns true.
 SELECT sportsedge_private.paper_advance_receipt(
  'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',4,'broker_filled',clock_timestamp(),'owner-A')
 INTO ok;
 IF ok THEN RAISE EXCEPTION 'STALE_VERSION_SUCCEEDED'; END IF;
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_receipt_events WHERE intent_id=
      'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')<>5 THEN
  RAISE EXCEPTION 'AUDIT_TRAIL_NOT_ATOMIC';
 END IF;
 -- Prevent changing the immutable client ID / economics post-creation.
 BEGIN
  UPDATE sportsedge_private.alpaca_paper_order_outbox
   SET client_order_id='new_client_id' WHERE signal_id='signal-A';
  RAISE EXCEPTION 'IMMUTABLE_REWRITE_SHOULD_DENY';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='IMMUTABLE_REWRITE_SHOULD_DENY' THEN RAISE; END IF;
 END;
END $$;
SELECT 'ALPACA_OUTBOX_ISOLATED_CAS_PASS' AS verification;
