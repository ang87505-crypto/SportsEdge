-- SportsEdge props budget v3 accounting (PROPOSAL, 2026-11-10). OWNER APPROVAL REQUIRED BEFORE APPLYING.
-- Additive. Lets a budget policy count what the provider actually charged (x-requests-last, already
-- recorded in props_provider_usage.requests_last) instead of the worst-case reservation, which today is
-- never refunded. Receipts show why this matters:
--  * every events-list call was reserved at 1 credit but charged 0 (remaining 500->497 after events plus one
--    3-credit event-odds call on Nov 7; 491->488 on Nov 8; 485->482 on Nov 9);
--  * the provider documents that empty replies are free and that event odds charge only markets returned,
--    so a capture attempt that finds no PrizePicks/Pick6 lines yet may cost 0 but still blocks 3 credits.
-- The limits themselves (daily, monthly, provider floor) are NOT changed here. With no policy row that sets
-- count_provider_actuals=true, props_reserve_credits behaves exactly as in props_v1.sql. The owner enables it
-- by inserting a new policy row, e.g.:
--   INSERT INTO public.props_budget_policy(version,daily_credits,monthly_credits,provider_floor,active_from,count_provider_actuals)
--   VALUES('props-budget-v3',7,200,60,'<approved instant>',true);
-- Rollback: insert a later row with count_provider_actuals=false (rows are append-only).
BEGIN;
ALTER TABLE public.props_budget_policy ADD COLUMN IF NOT EXISTS count_provider_actuals boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.props_reserve_credits(p_run bigint,p_endpoint text,p_event text,p_credits integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.props_control; pol public.props_budget_policy; d bigint; m bigint; remaining integer; rid bigint;
BEGIN
 SELECT * INTO STRICT c FROM public.props_control WHERE id=1 FOR UPDATE;
 IF c.state<>'RUNNING' THEN RAISE EXCEPTION 'PROPS_CONTROL_%',c.state; END IF;
 PERFORM public.props_require_running(p_run);
 SELECT * INTO STRICT pol FROM public.props_budget_policy WHERE active_from<=public.props_now()
  ORDER BY active_from DESC LIMIT 1;
 -- Effective cost: the provider-reported charge when the policy opts in and the reply was recorded,
 -- never more than the reservation; otherwise the reservation (unknown outcome = worst case).
 SELECT coalesce(sum(x.eff) FILTER (WHERE x.reserved_at>public.props_now()-interval '24 hours'),0),
        coalesce(sum(x.eff) FILTER (WHERE x.reserved_at>public.props_now()-interval '30 days'),0)
  INTO d,m FROM (
   SELECT r.reserved_at,CASE WHEN pol.count_provider_actuals AND u.requests_last IS NOT NULL
    THEN least(r.credits,u.requests_last) ELSE r.credits END AS eff
   FROM public.props_credit_reservations r LEFT JOIN public.props_provider_usage u ON u.reservation_id=r.id) x;
 IF d+p_credits>pol.daily_credits THEN RAISE EXCEPTION 'PROPS_BUDGET_DAILY_CAP'; END IF;
 IF m+p_credits>pol.monthly_credits THEN RAISE EXCEPTION 'PROPS_BUDGET_MONTHLY_CAP'; END IF;
 SELECT u.requests_remaining INTO remaining FROM public.props_provider_usage u
  WHERE u.requests_remaining IS NOT NULL ORDER BY u.recorded_at DESC,u.id DESC LIMIT 1;
 IF remaining IS NOT NULL AND remaining-p_credits<pol.provider_floor THEN RAISE EXCEPTION 'PROPS_BUDGET_PROVIDER_FLOOR'; END IF;
 INSERT INTO public.props_credit_reservations(run_id,endpoint,provider_event_id,credits,policy_version)
  VALUES(p_run,p_endpoint,p_event,p_credits,pol.version) RETURNING id INTO rid;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.props_reserve_credits(bigint,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.props_reserve_credits(bigint,text,text,integer) TO service_role;
COMMIT;
