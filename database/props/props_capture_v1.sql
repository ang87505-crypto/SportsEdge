-- SportsEdge props capture v1 (2026-11-10). Additive and append-only: the event-aware capture plan
-- (props-capture-v1), each capture claim made before a paid provider request, and each claim's outcome.
-- Plans are written before any of their lines are seen and are never edited, so the EARLY/LATE timing
-- study stays prospective. PAPER only: no account, no entry, no real money. Requires props_v1.sql.
-- Nothing here changes an existing table, function, budget policy or schedule. Safe to apply while the
-- tick release switch is off: no code writes these tables until PROPS_COLLECTION_V2.tickEnabled is true.
BEGIN;

CREATE TABLE public.props_capture_plans(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_version text NOT NULL CHECK(plan_version ~ '^props-capture-v[0-9]+$'),
 slate_date date NOT NULL,
 provider_event_id text NOT NULL CHECK(provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
 home_team text NOT NULL CHECK(length(home_team) BETWEEN 1 AND 120),
 away_team text NOT NULL CHECK(length(away_team) BETWEEN 1 AND 120),
 commence_time timestamptz NOT NULL,
 selected boolean NOT NULL,
 selection_rank integer NOT NULL CHECK(selection_rank BETWEEN 1 AND 100),
 arm text CHECK(arm IN ('early','late')),
 reason text NOT NULL CHECK(reason ~ '^[a-z0-9_]{2,60}$'),
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 planned_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(plan_version,provider_event_id),
 CHECK(selected=(arm IS NOT NULL))
);
CREATE INDEX props_capture_plans_slate ON public.props_capture_plans(slate_date);

-- One claim per (plan, capture key), inserted BEFORE the credit reservation and the paid request, so a
-- duplicate GitHub/Vercel trigger or a retried job can never repeat it.
CREATE TABLE public.props_captures(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id bigint NOT NULL REFERENCES public.props_capture_plans(id),
 provider_event_id text NOT NULL CHECK(provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 capture_key text NOT NULL CHECK(capture_key IN ('primary','retry','recheck')),
 window_name text NOT NULL CHECK(window_name IN ('early','late')),
 fallback boolean NOT NULL DEFAULT false,
 claimed_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(plan_id,capture_key)
);
CREATE INDEX props_captures_event ON public.props_captures(provider_event_id);

-- What the claim produced. A claim without an outcome is "unresolved" and is never retried automatically.
CREATE TABLE public.props_capture_outcomes(
 capture_id bigint PRIMARY KEY REFERENCES public.props_captures(id),
 outcome text NOT NULL CHECK(outcome IN ('stored','no_dfs_lines','budget_refused','provider_error','provider_http','event_locked','invalid_reply')),
 reservation_id bigint REFERENCES public.props_credit_reservations(id),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 provider_cost_last integer CHECK(provider_cost_last>=0),
 dfs_lines integer CHECK(dfs_lines>=0),
 lines_by_platform jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(lines_by_platform)='object' AND length(lines_by_platform::text)<=2000),
 minutes_to_tip numeric(8,1),
 recorded_at timestamptz NOT NULL DEFAULT public.props_now()
);

CREATE FUNCTION public.props_check_capture_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.planned_at:=public.props_now();
 -- A game can only be selected before it starts; the plan is never backdated.
 IF NEW.selected AND NEW.planned_at>=NEW.commence_time THEN RAISE EXCEPTION 'PROPS_CAPTURE_PLAN_CHRONOLOGY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_capture_plan_chronology BEFORE INSERT ON public.props_capture_plans
 FOR EACH ROW EXECUTE FUNCTION public.props_check_capture_plan();

CREATE FUNCTION public.props_check_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.props_capture_plans;
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.claimed_at:=public.props_now();
 SELECT * INTO p FROM public.props_capture_plans WHERE id=NEW.plan_id;
 IF NOT FOUND OR NOT p.selected OR p.provider_event_id<>NEW.provider_event_id THEN RAISE EXCEPTION 'PROPS_CAPTURE_NOT_PLANNED'; END IF;
 -- Never claim inside the 20-minute processing margin before tip-off (the lock buffer plus run time).
 IF NEW.claimed_at>=p.commence_time-interval '20 minutes' THEN RAISE EXCEPTION 'PROPS_CAPTURE_AFTER_LOCK'; END IF;
 IF NEW.claimed_at<p.planned_at THEN RAISE EXCEPTION 'PROPS_CAPTURE_BEFORE_PLAN'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_capture_chronology BEFORE INSERT ON public.props_captures
 FOR EACH ROW EXECUTE FUNCTION public.props_check_capture();

CREATE FUNCTION public.props_check_capture_outcome() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.props_captures;
BEGIN
 SELECT * INTO c FROM public.props_captures WHERE id=NEW.capture_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROPS_CAPTURE_UNKNOWN'; END IF;
 -- Only the run that claimed it may record the outcome, while it still holds its lease.
 PERFORM public.props_require_running(c.run_id);
 NEW.recorded_at:=public.props_now();
 IF NEW.reservation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.props_credit_reservations r
  WHERE r.id=NEW.reservation_id AND r.run_id=c.run_id AND r.provider_event_id=c.provider_event_id) THEN
  RAISE EXCEPTION 'PROPS_CAPTURE_RESERVATION_MISMATCH';
 END IF;
 IF NEW.outcome='stored' AND coalesce(NEW.dfs_lines,0)<1 THEN RAISE EXCEPTION 'PROPS_CAPTURE_STORED_WITHOUT_LINES'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_capture_outcome_check BEFORE INSERT ON public.props_capture_outcomes
 FOR EACH ROW EXECUTE FUNCTION public.props_check_capture_outcome();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_capture_plans','props_captures','props_capture_outcomes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.props_immutable()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['props_check_capture_plan()','props_check_capture()','props_check_capture_outcome()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
COMMIT;
