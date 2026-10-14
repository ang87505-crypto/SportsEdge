-- STAGING ONLY. Read-only review of unapproved paper drafts; v1-v4 required.
-- No approvals, broker writes, schedule, reset, or Production schema changes.
BEGIN;
CREATE FUNCTION public.sportsedge_paper_stage_drafts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM sportsedge_private.alpaca_paper_execution_gate
  WHERE account_alias='sportsedge-paper-stage' AND halted IS TRUE
 ) THEN RAISE EXCEPTION 'STAGING_GATE_NOT_HALTED'; END IF;
 IF EXISTS (
  SELECT 1 FROM sportsedge_private.alpaca_paper_order_outbox
  WHERE account_alias='sportsedge-paper-stage' AND status <> 'planned'
 ) THEN RAISE EXCEPTION 'STAGING_NON_DRAFT_RECEIPT_PRESENT'; END IF;
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_order_outbox
     WHERE account_alias='sportsedge-paper-stage') > 20
 THEN RAISE EXCEPTION 'STAGING_DRAFT_OVER_CAP'; END IF;
 SELECT jsonb_build_object(
  'environment','SportsEdge Staging','accountKind','paper',
  'gateHalted',true,'executionPermitted',false,'brokerCalls',0,
  'drafts',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'intentId',d.intent_id,'symbol',d.symbol,'shares',d.shares,
      'limitCents',d.limit_cents,'status',d.status,
      'createdAt',to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY d.created_at DESC,d.intent_id DESC)
    FROM sportsedge_private.alpaca_paper_order_outbox d
    WHERE d.account_alias='sportsedge-paper-stage'
  ),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sportsedge_paper_stage_drafts()
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sportsedge_paper_stage_drafts()
 TO service_role;
COMMIT;
