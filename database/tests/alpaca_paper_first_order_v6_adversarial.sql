\set ON_ERROR_STOP on
-- Independent adversarial checks of the staging v6 one-order contract.
-- Disposable PostgreSQL only; requires staging v1-v6. No broker API exists here.
DO $$
DECLARE r jsonb; ok boolean; n integer;
DECLARE a text:='preview-'||repeat('1',32);
DECLARE c text:='sepaper_'||repeat('2',32);
DECLARE d text:=repeat('3',64);
DECLARE o text:='owner-'||repeat('4',32);
BEGIN
 -- A missing gate row is never an approval path.
 ok:=false;
 BEGIN
  PERFORM public.sportsedge_paper_first_order_approve(a,c,'F',1299,d,o,
   clock_timestamp(),clock_timestamp()+interval '2 minutes',
   clock_timestamp()+interval '2 hours',1295,1298);
 EXCEPTION WHEN no_data_found THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'APPROVAL_WITHOUT_GATE_ROW'; END IF;
 PERFORM sportsedge_private.paper_force_halt('sportsedge-paper-stage','ADVERSARIAL_BASE');

 -- Each economic/time guard independently rejects, with nothing persisted.
 FOR n IN 1..6 LOOP
  ok:=false;
  BEGIN
   PERFORM public.sportsedge_paper_first_order_approve(a,c,'F',
    CASE n WHEN 4 THEN 1297 WHEN 5 THEN 1400 ELSE 1299 END,d,o,
    clock_timestamp(),
    CASE n WHEN 1 THEN clock_timestamp() WHEN 2 THEN clock_timestamp()+interval '4 minutes'
     ELSE clock_timestamp()+interval '2 minutes' END,
    CASE n WHEN 3 THEN clock_timestamp()+interval '19 minutes' ELSE clock_timestamp()+interval '2 hours' END,
    CASE n WHEN 6 THEN 1200 ELSE 1295 END,1298);
  EXCEPTION WHEN raise_exception THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'GUARD_% ACCEPTED',n; END IF;
 END LOOP;
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_order_outbox)<>0 THEN
  RAISE EXCEPTION 'REJECTED_APPROVAL_PERSISTED';
 END IF;

 -- An approval that expires before its claim is denied and the gate stays halted.
 r:=public.sportsedge_paper_first_order_approve(a,c,'F',1299,d,o,
   clock_timestamp(),clock_timestamp()+interval '1 second',
   clock_timestamp()+interval '2 hours',1295,1298);
 PERFORM pg_sleep(1.3);
 ok:=false;
 BEGIN PERFORM public.sportsedge_paper_first_order_claim(a);
 EXCEPTION WHEN raise_exception THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'EXPIRED_APPROVAL_CLAIMED'; END IF;
 IF (public.sportsedge_paper_first_order_gate()->>'halted')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'FAILED_CLAIM_LEFT_GATE_OPEN';
 END IF;

 -- FINDING: the expired, never-submitted approval now permanently occupies the
 -- lifetime one-order slot. No granted RPC can retire it (owner_approved->stopped),
 -- so a fresh approval is refused. Recovery needs a separately reviewed migration.
 ok:=false;
 BEGIN
  PERFORM public.sportsedge_paper_first_order_approve(
   'preview-'||repeat('5',32),'sepaper_'||repeat('6',32),'F',1299,d,o,
   clock_timestamp(),clock_timestamp()+interval '2 minutes',
   clock_timestamp()+interval '2 hours',1295,1298);
 EXCEPTION WHEN raise_exception THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'SECOND_LIFETIME_APPROVAL_ACCEPTED'; END IF;
 IF has_function_privilege('service_role',
   'sportsedge_private.paper_advance_receipt(text,integer,text,timestamptz,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'GENERIC_RECEIPT_CAS_EXPOSED'; END IF;
 IF has_schema_privilege('service_role','sportsedge_private','USAGE')
 OR has_schema_privilege('anon','sportsedge_private','USAGE')
 OR has_schema_privilege('authenticated','sportsedge_private','USAGE') THEN
  RAISE EXCEPTION 'PRIVATE_SCHEMA_EXPOSED';
 END IF;

 -- No v6 function is callable by browser roles; every one is granted to service_role.
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
 WHERE s.nspname='public' AND p.proname LIKE 'sportsedge_paper_%'
  AND (has_function_privilege('anon',p.oid,'EXECUTE')
    OR has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'));
 IF n<>0 THEN RAISE EXCEPTION 'RPC_ROLE_BOUNDARY_BROKEN %',n; END IF;
END $$;

-- A separate, fresh account history: uncertain receipts cannot be laundered.
TRUNCATE sportsedge_private.alpaca_first_order_approvals,
 sportsedge_private.alpaca_paper_receipt_events;
-- Direct cleanup is possible only for the disposable superuser in this test.
DROP INDEX sportsedge_private.alpaca_paper_first_order_lifetime_once;
DELETE FROM sportsedge_private.alpaca_paper_order_outbox;
CREATE UNIQUE INDEX alpaca_paper_first_order_lifetime_once
 ON sportsedge_private.alpaca_paper_order_outbox(account_alias)
 WHERE model_version='owner-reviewed-paper-test-v1';
DO $$
DECLARE r jsonb; ok boolean;
DECLARE a text:='preview-'||repeat('7',32);
BEGIN
 r:=public.sportsedge_paper_first_order_approve(a,'sepaper_'||repeat('8',32),'F',1299,
   repeat('9',64),'owner-'||repeat('a',32),clock_timestamp(),
   clock_timestamp()+interval '2 minutes',clock_timestamp()+interval '2 hours',1295,1298);
 r:=public.sportsedge_paper_first_order_claim(a);
 -- STOP while in flight closes the gate the TypeScript writer re-reads before POST.
 r:=public.sportsedge_paper_stage_halt();
 IF (public.sportsedge_paper_first_order_gate()->>'halted')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'STOP_DID_NOT_CLOSE_IN_FLIGHT_GATE';
 END IF;
 r:=public.sportsedge_paper_first_order_receipt(a,'submission_uncertain',NULL,'POST_OUTCOME_UNKNOWN');
 ok:=false;
 BEGIN PERFORM public.sportsedge_paper_first_order_receipt(a,'broker_acknowledged','late-id','new');
 EXCEPTION WHEN raise_exception THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'UNCERTAIN_RECEIPT_OVERWRITTEN'; END IF;
 IF (public.sportsedge_paper_first_order_status()->>'status')<>'submission_uncertain' THEN
  RAISE EXCEPTION 'UNCERTAIN_STATE_NOT_VISIBLE';
 END IF;
 ok:=false;
 BEGIN UPDATE sportsedge_private.alpaca_paper_order_outbox SET shares=2 WHERE intent_id=a;
 EXCEPTION WHEN raise_exception THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'INTENT_ECONOMICS_MUTABLE'; END IF;
END $$;
SELECT 'ONE_SHOT_V6_ADVERSARIAL_PASS' AS result;
