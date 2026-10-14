\set ON_ERROR_STOP on
-- Disposable PG17 only. Requires staging v1, stop v2, owner RPC v3.
DO $$
DECLARE st jsonb;
DECLARE newer jsonb;
BEGIN
 IF has_function_privilege('anon','public.sportsedge_paper_stage_status()','EXECUTE') OR
    has_function_privilege('authenticated','public.sportsedge_paper_stage_status()','EXECUTE') OR
    has_function_privilege('anon','public.sportsedge_paper_stage_halt()','EXECUTE') OR
    has_function_privilege('authenticated','public.sportsedge_paper_stage_halt()','EXECUTE') THEN
  RAISE EXCEPTION 'PUBLIC_CLIENT_RPC_LEAK';
 END IF;
 IF NOT has_function_privilege('service_role','public.sportsedge_paper_stage_status()','EXECUTE') OR
    NOT has_function_privilege('service_role','public.sportsedge_paper_stage_halt()','EXECUTE') THEN
  RAISE EXCEPTION 'SERVER_ROLE_PRIVILEGE_MISSING';
 END IF;
 st:=public.sportsedge_paper_stage_status();
 IF st->>'environment'<>'SportsEdge Staging' OR st->>'accountKind'<>'paper'
   OR st->>'halted'<>'true' OR st->>'executionPermitted'<>'false'
   OR (st->>'storedIntentCount')::integer<>0 THEN
  RAISE EXCEPTION 'STAGING_RPC_FAIL_OPEN';
 END IF;
 newer:=public.sportsedge_paper_stage_halt();
 IF newer->>'halted'<>'true' OR newer->>'gateConfigured'<>'true'
   OR (newer->>'haltAuditEvents')::integer<>1 OR
   newer->>'executionPermitted'<>'false' THEN
  RAISE EXCEPTION 'STOP_RPC_NOT_DURABLE';
 END IF;
 newer:=public.sportsedge_paper_stage_halt();
 IF newer->>'halted'<>'true' OR (newer->>'haltAuditEvents')::integer<>2 THEN
  RAISE EXCEPTION 'REPEATED_STOP_RPC_NOT_AUDITED';
 END IF;
 -- Even DB admins using the routine cannot use it as resume.
 BEGIN
  UPDATE sportsedge_private.alpaca_paper_execution_gate SET halted=false
    WHERE account_alias='sportsedge-paper-stage';
  RAISE EXCEPTION 'STAGING_EXECUTION_GATE_CAN_REOPEN';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='STAGING_EXECUTION_GATE_CAN_REOPEN' THEN RAISE; END IF;
 END;
END $$;
SELECT 'STAGING_OWNER_RPC_V3_PASS' AS result;
