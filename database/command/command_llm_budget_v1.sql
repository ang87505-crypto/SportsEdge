-- Command Center 2.0: shared AI inference budget and rate limit (PROPOSAL: apply only with owner approval, after the
-- Monday 2026-11-16 release). Every Vercel instance reserves the WORST-CASE cost of a model call here BEFORE making it,
-- under a row lock on the day, so instances together can never commit more than the daily cap. A call is settled with
-- its actual cost afterwards; a reservation that is never settled (crashed instance) stays counted at its worst case.
-- Amounts are integer micro-USD. Callable only by service_role. No other table or function is touched.

CREATE TABLE public.command_llm_days(
 day date PRIMARY KEY,
 cap_micro_usd bigint NOT NULL CHECK (cap_micro_usd > 0 AND cap_micro_usd <= 50000000),
 committed_micro_usd bigint NOT NULL DEFAULT 0 CHECK (committed_micro_usd >= 0)
);
CREATE TABLE public.command_llm_reservations(
 id bigserial PRIMARY KEY,
 day date NOT NULL REFERENCES public.command_llm_days(day),
 client_key text NOT NULL CHECK (client_key ~ '^[0-9a-f]{32}$'),
 model text NOT NULL CHECK (model ~ '^[a-z0-9.-]{3,60}$'),
 reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd > 0 AND reserved_micro_usd <= 5000000),
 actual_micro_usd bigint CHECK (actual_micro_usd >= 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 settled_at timestamptz
);
CREATE INDEX command_llm_reservations_recent ON public.command_llm_reservations(client_key, created_at);

-- Reserve the worst case of one model call. The effective cap is the LOWER of the stored cap and the caller's cap, so an
-- instance with a stale or higher configured cap can never raise the day's limit. Rate limit: calls per client per minute.
CREATE FUNCTION public.command_llm_reserve(p_client_key text, p_model text, p_micro_usd bigint, p_cap_micro_usd bigint, p_per_minute int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
 d date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
 v_cap bigint; v_committed bigint; v_recent int; v_id bigint;
BEGIN
 IF p_micro_usd IS NULL OR p_micro_usd <= 0 OR p_micro_usd > 5000000 OR p_cap_micro_usd IS NULL OR p_cap_micro_usd <= 0
    OR p_cap_micro_usd > 50000000 OR p_per_minute IS NULL OR p_per_minute < 1 OR p_per_minute > 60 THEN
  RAISE EXCEPTION 'COMMAND_LLM_BAD_ARGS';
 END IF;
 INSERT INTO public.command_llm_days(day, cap_micro_usd) VALUES (d, p_cap_micro_usd) ON CONFLICT (day) DO NOTHING;
 SELECT cap_micro_usd, committed_micro_usd INTO v_cap, v_committed FROM public.command_llm_days WHERE day = d FOR UPDATE;
 IF p_cap_micro_usd < v_cap THEN
  v_cap := p_cap_micro_usd;
  UPDATE public.command_llm_days SET cap_micro_usd = v_cap WHERE day = d;
 END IF;
 SELECT count(*) INTO v_recent FROM public.command_llm_reservations
  WHERE client_key = p_client_key AND created_at > clock_timestamp() - interval '60 seconds';
 IF v_recent >= p_per_minute THEN RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED'); END IF;
 IF v_committed + p_micro_usd > v_cap THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'BUDGET_EXHAUSTED', 'remaining', v_cap - v_committed);
 END IF;
 INSERT INTO public.command_llm_reservations(day, client_key, model, reserved_micro_usd)
  VALUES (d, p_client_key, p_model, p_micro_usd) RETURNING id INTO v_id;
 UPDATE public.command_llm_days SET committed_micro_usd = committed_micro_usd + p_micro_usd WHERE day = d;
 RETURN jsonb_build_object('ok', true, 'id', v_id, 'remaining', v_cap - v_committed - p_micro_usd);
END $$;

-- Settle a reservation with its actual cost (once; repeats are no-ops). Actual above the reservation is still recorded.
CREATE FUNCTION public.command_llm_settle(p_id bigint, p_actual_micro_usd bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.command_llm_reservations%ROWTYPE;
BEGIN
 IF p_actual_micro_usd IS NULL OR p_actual_micro_usd < 0 OR p_actual_micro_usd > 50000000 THEN RAISE EXCEPTION 'COMMAND_LLM_BAD_ARGS'; END IF;
 SELECT * INTO r FROM public.command_llm_reservations WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'UNKNOWN_RESERVATION'); END IF;
 IF r.settled_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_SETTLED'); END IF;
 PERFORM 1 FROM public.command_llm_days WHERE day = r.day FOR UPDATE;
 UPDATE public.command_llm_reservations SET actual_micro_usd = p_actual_micro_usd, settled_at = clock_timestamp() WHERE id = p_id;
 UPDATE public.command_llm_days SET committed_micro_usd = greatest(0, committed_micro_usd - r.reserved_micro_usd + p_actual_micro_usd)
  WHERE day = r.day;
 RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON public.command_llm_days, public.command_llm_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.command_llm_reservations_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.command_llm_days, public.command_llm_reservations TO service_role;
REVOKE ALL ON FUNCTION public.command_llm_reserve(text, text, bigint, bigint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_llm_settle(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.command_llm_reserve(text, text, bigint, bigint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.command_llm_settle(bigint, bigint) TO service_role;
