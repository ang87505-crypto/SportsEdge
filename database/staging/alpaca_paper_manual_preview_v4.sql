-- STAGING ONLY. Durable record of ONE manually specified proposed PAPER trade.
-- Requires staged outbox v1, permanent HALT v2, owner status v3.
-- Stores draft (status=planned), does NOT authorize/order/schedule/broker POST.
-- Deliberately cannot change an existing row or reopen a HALTED gate.
BEGIN;
CREATE FUNCTION public.sportsedge_paper_stage_preview(
 p_intent_id text, p_symbol text, p_limit_cents bigint,
 p_client_order_id text, p_source_digest text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old sportsedge_private.alpaca_paper_order_outbox%ROWTYPE;
DECLARE gate_is_halted boolean;
BEGIN
 IF p_intent_id IS NULL OR p_intent_id !~ '^preview-[a-f0-9]{32}$'
  OR p_symbol IS NULL OR p_symbol !~ '^[A-Z]{1,5}$'
  OR p_limit_cents IS NULL OR p_limit_cents NOT BETWEEN 1 AND 2500
  OR p_client_order_id IS NULL OR p_client_order_id !~ '^sepaper_[a-f0-9]{32}$'
  OR p_source_digest IS NULL OR p_source_digest !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'PAPER_DRAFT_INVALID';
 END IF;
 SELECT halted INTO gate_is_halted
 FROM sportsedge_private.alpaca_paper_execution_gate
 WHERE account_alias='sportsedge-paper-stage' FOR SHARE;
 IF coalesce(gate_is_halted,false) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'STAGING_GATE_NOT_VERIFIABLY_HALTED';
 END IF;
 -- Serialize staging preview creation and cap unexecuted drafts to 20.
 -- This is not a trading quota; it only protects the staging database from spam.
 PERFORM pg_advisory_xact_lock(hashtext('sportsedge-paper-stage-preview-v1'));
 IF (SELECT count(*) FROM sportsedge_private.alpaca_paper_order_outbox
     WHERE account_alias='sportsedge-paper-stage')>=20 THEN
  RAISE EXCEPTION 'PAPER_DRAFT_CAP_REACHED';
 END IF;
 -- Database unique constraints deny repeated intent/client order identities.
 INSERT INTO sportsedge_private.alpaca_paper_order_outbox (
  intent_id,account_alias,signal_id,signal_digest,model_version,
  client_order_id,symbol,shares,limit_cents,status
 ) VALUES (
  p_intent_id,'sportsedge-paper-stage',p_intent_id,
  p_source_digest,'manual-unverified-test-draft-v1',
  p_client_order_id,p_symbol,1,p_limit_cents,'planned'
 ) ON CONFLICT DO NOTHING;
 SELECT * INTO old FROM sportsedge_private.alpaca_paper_order_outbox
 WHERE intent_id=p_intent_id;
 IF NOT FOUND OR old.account_alias<>'sportsedge-paper-stage' OR
    old.signal_id<>p_intent_id OR old.signal_digest<>p_source_digest OR
    old.model_version<>'manual-unverified-test-draft-v1' OR
    old.client_order_id<>p_client_order_id OR old.symbol<>p_symbol OR
    old.shares<>1 OR old.limit_cents<>p_limit_cents OR
    old.status<>'planned' THEN
  RAISE EXCEPTION 'PAPER_DRAFT_CONFLICT';
 END IF;
 RETURN jsonb_build_object(
  'status','planned',
  'environment','SportsEdge Staging',
  'accountKind','paper',
  'intentId',old.intent_id,
  'symbol',old.symbol,
  'shares',1,
  'limitCents',old.limit_cents,
  'executionPermitted',false,
  'brokerCalls',0,
  'approved',false,
  'gateHalted',true
 );
END $$;
REVOKE ALL ON FUNCTION public.sportsedge_paper_stage_preview(text,text,bigint,text,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sportsedge_paper_stage_preview(text,text,bigint,text,text)
 TO service_role;
COMMIT;
