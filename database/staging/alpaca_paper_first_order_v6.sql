-- STAGING-ONLY v6: one owner-approved Alpaca PAPER test order, never recurring.
-- Extends v1-v5. Production is explicitly unsupported. Requires review of
-- existing hard HALT v2 and adds an equally strict per-order release guard.
BEGIN;
CREATE TABLE sportsedge_private.alpaca_first_order_approvals (
 intent_id text PRIMARY KEY REFERENCES sportsedge_private.alpaca_paper_order_outbox(intent_id),
 approved_until timestamptz NOT NULL,
 quote_verified_at timestamptz NOT NULL,
 session_close_at timestamptz NOT NULL,
 quote_bid_cents bigint NOT NULL CHECK(quote_bid_cents BETWEEN 1 AND 2500),
 quote_ask_cents bigint NOT NULL CHECK(quote_ask_cents BETWEEN 1 AND 2500),
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 broker_status text,
 CONSTRAINT first_order_valid_quote CHECK(quote_bid_cents <= quote_ask_cents),
 CONSTRAINT first_order_short_approval CHECK(approved_until <= approved_at + interval '3 minutes')
);
ALTER TABLE sportsedge_private.alpaca_first_order_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sportsedge_private.alpaca_first_order_approvals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sportsedge_private.alpaca_first_order_approvals FROM PUBLIC, anon, authenticated;
-- A hard, durable, lifetime one-order cap per staging account. Never delete or
-- replace this row to "reset" the first test. Repeated owner clicks fail closed.
CREATE UNIQUE INDEX alpaca_paper_first_order_lifetime_once
 ON sportsedge_private.alpaca_paper_order_outbox(account_alias)
 WHERE model_version='owner-reviewed-paper-test-v1';

-- Replace v2's hard HALT rule ONLY in staging: one checked owner-approved intent
-- may be temporarily armed inside the SECURITY DEFINER claim transaction.
-- No general resume function is added. All other reopen attempts still fail.
CREATE OR REPLACE FUNCTION sportsedge_private.paper_require_halted()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.halted IS DISTINCT FROM TRUE THEN
  IF TG_OP <> 'UPDATE' OR OLD.halted IS DISTINCT FROM TRUE OR
     NEW.account_alias <> 'sportsedge-paper-stage' OR
     NOT EXISTS (
       SELECT 1 FROM sportsedge_private.alpaca_paper_order_outbox o
       JOIN sportsedge_private.alpaca_first_order_approvals a USING(intent_id)
       WHERE o.account_alias=NEW.account_alias
        AND o.status='owner_approved' AND o.lock_version=1
        AND a.approved_until>clock_timestamp()
        AND a.quote_verified_at>=clock_timestamp()-interval '60 seconds'
        AND a.session_close_at>clock_timestamp()+interval '20 minutes'
     ) THEN
   RAISE EXCEPTION 'PAPER_RESTART_NOT_AUTHORIZED';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.sportsedge_paper_first_order_approve(
 p_intent text,p_client text,p_symbol text,p_limit bigint,p_digest text,
 p_owner_ref text,p_quote_at timestamptz,p_until timestamptz,
 p_close_at timestamptz,p_bid bigint,p_ask bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE g sportsedge_private.alpaca_paper_execution_gate%ROWTYPE;
DECLARE t timestamptz:=clock_timestamp();
BEGIN
 IF p_intent IS NULL OR p_intent !~ '^preview-[a-f0-9]{32}$'
 OR p_client IS NULL OR p_client !~ '^sepaper_[a-f0-9]{32}$'
 OR p_symbol IS NULL OR p_symbol !~ '^[A-Z]{1,5}$'
 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2500
 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_owner_ref IS NULL OR p_owner_ref !~ '^owner-[a-f0-9]{32}$'
 OR p_quote_at IS NULL OR p_quote_at>t+interval '2 seconds'
 OR p_quote_at<t-interval '60 seconds'
 OR p_until IS NULL OR p_until<=t OR p_until>t+interval '3 minutes'
 OR p_close_at IS NULL OR p_close_at<=t+interval '20 minutes'
 OR p_close_at>t+interval '9 hours'
 OR p_bid IS NULL OR p_ask IS NULL OR p_bid NOT BETWEEN 1 AND 2500
 OR p_ask NOT BETWEEN p_bid AND 2500
 OR p_ask-p_bid>greatest(5,floor(p_ask*0.02)::bigint)
 OR p_limit<p_ask OR p_limit>least(2500,p_ask+greatest(5,floor(p_ask*0.02)::bigint))
 THEN RAISE EXCEPTION 'FIRST_ORDER_APPROVAL_INVALID'; END IF;
 -- Serialize every first-order approval/claim/stop on the same gate row.
 SELECT * INTO STRICT g FROM sportsedge_private.alpaca_paper_execution_gate
 WHERE account_alias='sportsedge-paper-stage' FOR UPDATE;
 IF g.halted IS DISTINCT FROM TRUE OR
    EXISTS(SELECT 1 FROM sportsedge_private.alpaca_paper_order_outbox
     WHERE account_alias='sportsedge-paper-stage'
       AND status<>'planned') THEN
  RAISE EXCEPTION 'FIRST_ORDER_PREVIOUS_INTENT_OR_GATE_NOT_HALTED';
 END IF;
 INSERT INTO sportsedge_private.alpaca_paper_order_outbox (
  intent_id,account_alias,signal_id,signal_digest,model_version,
  client_order_id,symbol,shares,limit_cents,status,
  lock_version,owner_approval_ref
 ) VALUES (
  p_intent,'sportsedge-paper-stage',p_intent,p_digest,
  'owner-reviewed-paper-test-v1',p_client,p_symbol,1,p_limit,
  'owner_approved',1,p_owner_ref
 );
 INSERT INTO sportsedge_private.alpaca_first_order_approvals(
  intent_id,approved_until,quote_verified_at,session_close_at,
  quote_bid_cents,quote_ask_cents
 ) VALUES(p_intent,p_until,p_quote_at,p_close_at,p_bid,p_ask);
 INSERT INTO sportsedge_private.alpaca_paper_receipt_events(
  intent_id,receipt_version,previous_state,next_state,observed_at,
  owner_approval_ref
 ) VALUES(p_intent,1,'planned','owner_approved',t,p_owner_ref);
 RETURN jsonb_build_object('status','owner_approved',
  'environment','SportsEdge Staging','accountKind','paper',
  'intentId',p_intent,'symbol',p_symbol,'shares',1,
  'limitCents',p_limit,'gateHalted',true,'brokerCalls',0);
END $$;

CREATE FUNCTION public.sportsedge_paper_first_order_claim(p_intent text)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog AS $$
DECLARE o sportsedge_private.alpaca_paper_order_outbox%ROWTYPE;
DECLARE a sportsedge_private.alpaca_first_order_approvals%ROWTYPE;
DECLARE g sportsedge_private.alpaca_paper_execution_gate%ROWTYPE;
DECLARE t timestamptz:=clock_timestamp();
BEGIN
 IF p_intent IS NULL OR p_intent !~ '^preview-[a-f0-9]{32}$'
 THEN RAISE EXCEPTION 'CLAIM_INVALID_ID'; END IF;
 SELECT * INTO STRICT g FROM sportsedge_private.alpaca_paper_execution_gate
 WHERE account_alias='sportsedge-paper-stage' FOR UPDATE;
 SELECT * INTO STRICT o FROM sportsedge_private.alpaca_paper_order_outbox
 WHERE intent_id=p_intent FOR UPDATE;
 SELECT * INTO STRICT a FROM sportsedge_private.alpaca_first_order_approvals
 WHERE intent_id=p_intent FOR UPDATE;
 IF g.halted IS DISTINCT FROM TRUE OR o.account_alias<>'sportsedge-paper-stage'
 OR o.status<>'owner_approved' OR o.lock_version<>1 OR o.shares<>1
 OR o.model_version<>'owner-reviewed-paper-test-v1'
 OR o.limit_cents NOT BETWEEN 1 AND 2500
 OR a.approved_until<=t OR a.quote_verified_at<t-interval '60 seconds'
 OR a.session_close_at<=t+interval '20 minutes'
 THEN RAISE EXCEPTION 'FIRST_ORDER_CLAIM_DENIED'; END IF;
 UPDATE sportsedge_private.alpaca_paper_execution_gate
 SET halted=false,halt_reason='ONE_APPROVED_PAPER_ORDER_IN_FLIGHT',updated_at=t
 WHERE account_alias='sportsedge-paper-stage';
 IF sportsedge_private.paper_advance_receipt(
   p_intent,1,'submitting',t,o.owner_approval_ref,NULL
 ) IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIRST_ORDER_CAS_FAILED'; END IF;
 RETURN jsonb_build_object(
  'environment','SportsEdge Staging','accountKind','paper',
  'accountAlias','sportsedge-paper-stage','status','submitting',
  'lockVersion',2,'intentId',o.intent_id,'clientOrderId',o.client_order_id,
  'symbol',o.symbol,'shares',1,'limitCents',o.limit_cents,
  'ownerApprovalRef',o.owner_approval_ref,'modelVersion',o.model_version,
  'sourceDigest',trim(o.signal_digest),
  'quoteVerifiedAt',to_char(a.quote_verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'approvedUntil',to_char(a.approved_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'sessionCloseAt',to_char(a.session_close_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'signalReviewed',true,'marketPriceReviewed',true,
  'accountReconciled',true,'receiptReconciled',true
 );
END $$;

CREATE FUNCTION public.sportsedge_paper_first_order_gate()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('halted',COALESCE((
  SELECT halted FROM sportsedge_private.alpaca_paper_execution_gate
  WHERE account_alias='sportsedge-paper-stage'),true))
$$;
CREATE FUNCTION public.sportsedge_paper_first_order_receipt(
 p_intent text,p_state text,p_broker text,p_status text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog AS $$
DECLARE o sportsedge_private.alpaca_paper_order_outbox%ROWTYPE;
BEGIN
 IF p_intent IS NULL OR p_intent !~ '^preview-[a-f0-9]{32}$'
 OR p_state NOT IN ('broker_acknowledged','submission_uncertain')
 OR (p_state='broker_acknowledged' AND
  (p_broker IS NULL OR length(p_broker) NOT BETWEEN 1 AND 128))
 OR p_status IS NULL OR length(p_status) NOT BETWEEN 1 AND 80
 THEN RAISE EXCEPTION 'RECEIPT_INVALID'; END IF;
 SELECT * INTO STRICT o FROM sportsedge_private.alpaca_paper_order_outbox
 WHERE intent_id=p_intent FOR UPDATE;
 IF o.status<>'submitting' OR o.lock_version<>2 OR
 o.model_version<>'owner-reviewed-paper-test-v1'
 THEN RAISE EXCEPTION 'RECEIPT_CAS_NOT_PROVEN'; END IF;
 IF sportsedge_private.paper_advance_receipt(
  p_intent,2,p_state,clock_timestamp(),o.owner_approval_ref,p_broker
 ) IS DISTINCT FROM true THEN RAISE EXCEPTION 'RECEIPT_CAS_FAILED'; END IF;
 UPDATE sportsedge_private.alpaca_first_order_approvals
 SET broker_status=p_status WHERE intent_id=p_intent;
 RETURN jsonb_build_object('saved',true,'state',p_state);
END $$;
CREATE FUNCTION public.sportsedge_paper_first_order_status()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((
  SELECT jsonb_build_object(
   'status',o.status,'intentId',o.intent_id,'symbol',o.symbol,
   'shares',o.shares,'limitCents',o.limit_cents,
   'brokerOrderObserved',o.broker_order_id IS NOT NULL,
   'brokerStatus',a.broker_status,'gateHalted',coalesce(
    (SELECT halted FROM sportsedge_private.alpaca_paper_execution_gate
     WHERE account_alias='sportsedge-paper-stage'),true))
  FROM sportsedge_private.alpaca_paper_order_outbox o
  JOIN sportsedge_private.alpaca_first_order_approvals a USING(intent_id)
  WHERE o.account_alias='sportsedge-paper-stage'
  ORDER BY o.created_at DESC LIMIT 1),
 jsonb_build_object('status','not_authorized','gateHalted',true))
$$;
REVOKE ALL ON FUNCTION
 public.sportsedge_paper_first_order_approve(text,text,text,bigint,text,text,timestamptz,timestamptz,timestamptz,bigint,bigint),
 public.sportsedge_paper_first_order_claim(text),
 public.sportsedge_paper_first_order_gate(),
 public.sportsedge_paper_first_order_receipt(text,text,text,text),
 public.sportsedge_paper_first_order_status()
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
 public.sportsedge_paper_first_order_approve(text,text,text,bigint,text,text,timestamptz,timestamptz,timestamptz,bigint,bigint),
 public.sportsedge_paper_first_order_claim(text),
 public.sportsedge_paper_first_order_gate(),
 public.sportsedge_paper_first_order_receipt(text,text,text,text),
 public.sportsedge_paper_first_order_status()
 TO service_role;
COMMIT;
