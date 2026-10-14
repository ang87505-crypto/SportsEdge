-- STAGING ONLY. NO PRODUCTION APP MIGRATION. Requires staging v1 + v2.
-- An owner-authenticated server (never browser code) may inspect the status
-- of the permanently HALTED staging outbox or request an additional HALT.
-- Deliberately provides NO order insert, resume, approve or submit RPC.
BEGIN;
CREATE FUNCTION public.sportsedge_paper_stage_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'environment','SportsEdge Staging',
  'accountKind','paper',
  'gateConfigured', EXISTS(
   SELECT 1 FROM sportsedge_private.alpaca_paper_execution_gate
   WHERE account_alias='sportsedge-paper-stage'),
  'halted',COALESCE((
   SELECT halted FROM sportsedge_private.alpaca_paper_execution_gate
   WHERE account_alias='sportsedge-paper-stage'),true),
  'storedIntentCount',(
   SELECT COUNT(*) FROM sportsedge_private.alpaca_paper_order_outbox
   WHERE account_alias='sportsedge-paper-stage'),
  'unresolvedReceiptCount',(
   SELECT COUNT(*) FROM sportsedge_private.alpaca_paper_order_outbox
   WHERE account_alias='sportsedge-paper-stage'
    AND status IN ('owner_approved','submitting','broker_acknowledged','submission_uncertain')),
  'haltAuditEvents',(
   SELECT COUNT(*) FROM sportsedge_private.alpaca_paper_halt_audit
   WHERE account_alias='sportsedge-paper-stage'),
  'automaticOrdersEnabled',false,
  'realMoneyOrdersEnabled',false,
  'executionPermitted',false
 );
$$;
CREATE FUNCTION public.sportsedge_paper_stage_halt()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Only a monotonically more restrictive state is possible.
 -- The staging gate cannot be unhalted through these functions.
 PERFORM sportsedge_private.paper_force_halt(
  'sportsedge-paper-stage','OWNER_REQUESTED_PAPER_HALT');
 RETURN public.sportsedge_paper_stage_status();
END $$;
-- PostgreSQL functions default to PUBLIC EXECUTE unless revoked explicitly.
REVOKE ALL ON FUNCTION public.sportsedge_paper_stage_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sportsedge_paper_stage_halt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sportsedge_paper_stage_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.sportsedge_paper_stage_halt() TO service_role;
COMMIT;
