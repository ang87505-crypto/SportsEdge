\set ON_ERROR_STOP on
-- Disposable PG17 ONLY. Required staging migrations v1, v2, v3, v4.
DO $$
DECLARE r jsonb;
DECLARE refused boolean;
BEGIN
 IF has_function_privilege('anon','public.sportsedge_paper_stage_preview(text,text,bigint,text,text)','EXECUTE') OR
   has_function_privilege('authenticated','public.sportsedge_paper_stage_preview(text,text,bigint,text,text)','EXECUTE') OR
   NOT has_function_privilege('service_role','public.sportsedge_paper_stage_preview(text,text,bigint,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'STAGING_PREVIEW_ROLE_PERMISSIONS_INVALID';
 END IF;
 PERFORM sportsedge_private.paper_force_halt('sportsedge-paper-stage','DISPOSABLE_STAGE_STOP');
 r:=public.sportsedge_paper_stage_preview('preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','F',1234,
  'sepaper_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('b',64));
 IF r->>'status'<>'planned' OR r->>'executionPermitted'<>'false' OR
   r->>'approved'<>'false' OR r->>'gateHalted'<>'true' OR
   r->>'brokerCalls'<>'0' THEN RAISE EXCEPTION 'DRAFT_CLAIMED_EXECUTION';END IF;
 IF (SELECT status FROM sportsedge_private.alpaca_paper_order_outbox
     WHERE intent_id='preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')<>'planned' THEN
  RAISE EXCEPTION 'STAGING_DRAFT_NOT_PLANNED';END IF;
 -- Idempotent, identical request can read the existing planned row.
 r:=public.sportsedge_paper_stage_preview('preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','F',1234,
  'sepaper_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('b',64));
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_order_outbox
    WHERE account_alias='sportsedge-paper-stage')<>1 THEN
  RAISE EXCEPTION 'DUPLICATE_DRAFT_CREATED';END IF;
 refused:=false;
 BEGIN
  PERFORM public.sportsedge_paper_stage_preview('preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','F',1235,
    'sepaper_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('b',64));
 EXCEPTION WHEN OTHERS THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'MUTATED_DRAFT_ACCEPTED';END IF;
 -- Limits cap execution economics and stock ticker shape.
 refused:=false;
 BEGIN
  PERFORM public.sportsedge_paper_stage_preview('preview-cccccccccccccccccccccccccccccccc','F',2501,
    'sepaper_cccccccccccccccccccccccccccccccc',repeat('c',64));
 EXCEPTION WHEN OTHERS THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'PRICE_ABOVE_LIMIT_ACCEPTED';END IF;
 refused:=false;
 BEGIN
  PERFORM public.sportsedge_paper_stage_preview('preview-cccccccccccccccccccccccccccccccc','BTCUSD',200,
    'sepaper_cccccccccccccccccccccccccccccccc',repeat('c',64));
 EXCEPTION WHEN OTHERS THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'NON_SIMPLE_EQUITY_SYMBOL_ACCEPTED';END IF;
 -- Planned staging preview cannot be approved while the HALT is in force.
 refused:=false;
 BEGIN
  PERFORM sportsedge_private.paper_advance_receipt(
    'preview-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,
    'owner_approved',clock_timestamp(),'owner-test');
 EXCEPTION WHEN OTHERS THEN refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'PAPER_APPROVAL_ALLOWED_WHILE_HALTED';END IF;
END $$;
SELECT 'PAPER_MANUAL_PREVIEW_V4_DISPOSABLE_PASS' AS result;
