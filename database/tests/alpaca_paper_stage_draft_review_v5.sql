\set ON_ERROR_STOP on
-- Disposable Postgres 17 only. After staging v1-v5.
DO $$
DECLARE r jsonb;
DECLARE refused boolean:=false;
BEGIN
 IF has_function_privilege('anon','public.sportsedge_paper_stage_drafts()','EXECUTE')
 OR has_function_privilege('authenticated','public.sportsedge_paper_stage_drafts()','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sportsedge_paper_stage_drafts()','EXECUTE')
 THEN RAISE EXCEPTION 'DRAFT_READER_PERMISSION_ERROR'; END IF;
 PERFORM sportsedge_private.paper_force_halt('sportsedge-paper-stage','DISPOSABLE_REVIEW_STOP');
 r:=public.sportsedge_paper_stage_drafts();
 IF r->>'environment'<>'SportsEdge Staging'
 OR r->>'gateHalted'<>'true' OR r->>'executionPermitted'<>'false'
 OR r->>'brokerCalls'<>'0' OR jsonb_array_length(r->'drafts')<>0
 THEN RAISE EXCEPTION 'UNSAFE_OR_NONEMPTY_INITIAL_DRAFTS'; END IF;
 PERFORM public.sportsedge_paper_stage_preview(
 'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','F',1299,
 'sepaper_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('b',64));
 r:=public.sportsedge_paper_stage_drafts();
 IF jsonb_array_length(r->'drafts')<>1 OR
 r->'drafts'->0->>'intentId'<>'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' OR
 r->'drafts'->0->>'symbol'<>'F' OR r->'drafts'->0->>'limitCents'<>'1299'
 OR r->'drafts'->0->>'status'<>'planned'
 OR NOT (r->'drafts'->0 ? 'createdAt')
 OR (r->'drafts'->0 ? 'clientOrderId')
 THEN RAISE EXCEPTION 'REVIEW_DRAFT_PAYLOAD_UNSAFE'; END IF;
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_order_outbox)<>1
 THEN RAISE EXCEPTION 'READ_CREATED_ANOTHER_DRAFT'; END IF;
 UPDATE sportsedge_private.alpaca_paper_execution_gate SET halted=true
 WHERE account_alias='sportsedge-paper-stage';
 -- The stop trigger prohibits unhalting even for privileged direct updates.
 BEGIN
  UPDATE sportsedge_private.alpaca_paper_execution_gate SET halted=false
  WHERE account_alias='sportsedge-paper-stage';
 EXCEPTION WHEN OTHERS THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'UNHALT_ACCEPTED'; END IF;
END $$;
SELECT 'STAGING_DRAFT_REVIEW_V5_DISPOSABLE_PASS' AS result;
