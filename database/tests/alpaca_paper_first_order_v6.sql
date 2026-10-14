\set ON_ERROR_STOP on
-- Runs only in disposable Postgres; no broker API is available in this job.
DO $$
DECLARE t timestamptz:=clock_timestamp(); r jsonb; err boolean;
DECLARE first text:='preview-'||repeat('a',32);
BEGIN
 IF has_function_privilege('anon','public.sportsedge_paper_first_order_claim(text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sportsedge_paper_first_order_approve(text,text,text,bigint,text,text,timestamptz,timestamptz,timestamptz,bigint,bigint)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sportsedge_paper_first_order_gate()','EXECUTE') THEN
  RAISE EXCEPTION 'BROKEN_STAGING_ROLE_BOUNDARY';
 END IF;
 PERFORM sportsedge_private.paper_force_halt('sportsedge-paper-stage','ONE_SHOT_CI_BASE');
 err:=false;
 BEGIN
  UPDATE sportsedge_private.alpaca_paper_execution_gate SET halted=false
  WHERE account_alias='sportsedge-paper-stage';
 EXCEPTION WHEN raise_exception THEN err:=true;END;
 IF NOT err THEN RAISE EXCEPTION 'UNAUTHORIZED_UNHALT_POSSIBLE';END IF;
 -- Mismatched economics and stale quote are blocked without a saved approval.
 err:=false;
 BEGIN
  PERFORM public.sportsedge_paper_first_order_approve(
   first,'sepaper_'||repeat('b',32),'F',1299,
   repeat('c',64),'owner-'||repeat('d',32),
   t-interval '10 minutes',t+interval '2 minutes',t+interval '2 hours',1295,1298);
 EXCEPTION WHEN raise_exception THEN err:=true;END;
 IF NOT err THEN RAISE EXCEPTION 'STALE_QUOTE_APPROVED';END IF;
 r:=public.sportsedge_paper_first_order_approve(
  first,'sepaper_'||repeat('b',32),'F',1299,
  repeat('c',64),'owner-'||repeat('d',32),
  clock_timestamp(),clock_timestamp()+interval '2 minutes',
  clock_timestamp()+interval '2 hours',1295,1298);
 IF r->>'status'<>'owner_approved' OR r->>'gateHalted'<>'true' THEN
  RAISE EXCEPTION 'APPROVAL_NOT_RECORDED';
 END IF;
 err:=false;
 BEGIN
  PERFORM public.sportsedge_paper_first_order_approve(
   'preview-'||repeat('e',32),'sepaper_'||repeat('f',32),'F',1299,
   repeat('c',64),'owner-'||repeat('d',32),
   clock_timestamp(),clock_timestamp()+interval '2 minutes',
   clock_timestamp()+interval '2 hours',1295,1298);
 EXCEPTION WHEN raise_exception THEN err:=true;END;
 IF NOT err THEN RAISE EXCEPTION 'SECOND_APPROVAL_POSSIBLE';END IF;
 -- Atomic claim and once-only receipt version transition.
 r:=public.sportsedge_paper_first_order_claim(first);
 IF r->>'status'<>'submitting' OR (r->>'lockVersion')::int<>2 OR
  r->>'clientOrderId'<>'sepaper_'||repeat('b',32) OR
  (public.sportsedge_paper_first_order_gate()->>'halted')::boolean IS DISTINCT FROM FALSE
 THEN RAISE EXCEPTION 'CLAIM_OR_STOP_INCORRECT';END IF;
 err:=false;
 BEGIN PERFORM public.sportsedge_paper_first_order_claim(first);
 EXCEPTION WHEN raise_exception THEN err:=true; END;
 IF NOT err THEN RAISE EXCEPTION 'SECOND_CLAIM_POSSIBLE';END IF;
 r:=public.sportsedge_paper_first_order_receipt(
  first,'broker_acknowledged','mock-paper-only-receipt-1','new');
 IF r->>'saved'<>'true' THEN RAISE EXCEPTION 'ACK_NOT_DURABLE';END IF;
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_receipt_events
     WHERE intent_id=first)<>3 THEN RAISE EXCEPTION 'MISSING_IMMUTABLE_RECEIPTS';END IF;
 err:=false;
 BEGIN PERFORM public.sportsedge_paper_first_order_receipt(
  first,'broker_acknowledged','another-id','new');
 EXCEPTION WHEN raise_exception THEN err:=true;END;
 IF NOT err THEN RAISE EXCEPTION 'DUPLICATE_ACK_POSSIBLE';END IF;
 PERFORM sportsedge_private.paper_force_halt('sportsedge-paper-stage','POST_ORDER_HALT_CI');
 IF (public.sportsedge_paper_first_order_gate()->>'halted')::boolean IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'EMERGENCY_STOP_NOT_RESTORED';END IF;
 err:=false;
 BEGIN UPDATE sportsedge_private.alpaca_paper_execution_gate SET halted=false
  WHERE account_alias='sportsedge-paper-stage';
 EXCEPTION WHEN raise_exception THEN err:=true;END;
 IF NOT err THEN RAISE EXCEPTION 'REARM_WITHOUT_APPROVED_INTENT';END IF;
 err:=false;
 BEGIN
  INSERT INTO sportsedge_private.alpaca_paper_order_outbox(
   intent_id,account_alias,signal_id,signal_digest,model_version,client_order_id,
   symbol,shares,limit_cents,status,lock_version,owner_approval_ref)
  VALUES('preview-'||repeat('f',32),'sportsedge-paper-stage',
   'another-intent',repeat('f',64),'owner-reviewed-paper-test-v1',
   'sepaper_'||repeat('f',32),'F',1,1299,'owner_approved',1,
   'owner-'||repeat('f',32));
 EXCEPTION WHEN unique_violation THEN err:=true;END;
 IF NOT err THEN RAISE EXCEPTION 'LIFETIME_ONE_ORDER_CAP_BYPASSED'; END IF;
END $$;
SELECT 'ONE_SHOT_CI_POSTGRES_PASS' as result;
