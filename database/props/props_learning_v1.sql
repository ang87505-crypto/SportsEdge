-- SportsEdge props learning v1 (2026-11-08). Additive and append-only: learning-layer artifacts,
-- model lifecycle events, the active-model control log, weekly learning reports, and account
-- activations for the v2 selection accounts. Paper only: no account, entry or money leaves SportsEdge.
-- Requires props_v1.sql (and is independent of props_market_v1.sql).
BEGIN;

CREATE TABLE public.props_model_artifacts(
 version text PRIMARY KEY CHECK(version ~ '^props-learn-v[0-9]+$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 artifact jsonb NOT NULL CHECK(jsonb_typeof(artifact)='object' AND length(artifact::text)<=200000),
 created_at timestamptz NOT NULL DEFAULT public.props_now()
);

CREATE TABLE public.props_model_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 version text NOT NULL REFERENCES public.props_model_artifacts(version),
 event text NOT NULL CHECK(event IN ('created','dropped','shadow_start','eligible','promoted','rolled_back','retired')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 100),
 detail jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(detail)='object' AND length(detail::text)<=20000),
 at timestamptz NOT NULL DEFAULT public.props_now()
);
CREATE INDEX props_model_events_version ON public.props_model_events(version,id);

CREATE TABLE public.props_model_control_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 active_model_version text NOT NULL CHECK(active_model_version ~ '^props-[a-z0-9-]+-v[0-9]+$'),
 previous_model_version text CHECK(previous_model_version ~ '^props-[a-z0-9-]+-v[0-9]+$'),
 learning_enabled boolean NOT NULL,
 auto_switch_enabled boolean NOT NULL,
 changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 100),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 at timestamptz NOT NULL DEFAULT public.props_now()
);
INSERT INTO public.props_model_control_log(active_model_version,previous_model_version,learning_enabled,auto_switch_enabled,changed_by,reason)
 VALUES('props-nb-minutes-rate-v1',NULL,true,true,'system:migration','Initial: stats model active; learning and auto-switch on');
CREATE VIEW public.props_model_control WITH (security_invoker=true) AS
 SELECT active_model_version,previous_model_version,learning_enabled,auto_switch_enabled,changed_by,reason,at
 FROM public.props_model_control_log ORDER BY id DESC LIMIT 1;

CREATE TABLE public.props_learning_reports(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 period_from date NOT NULL,
 period_to date NOT NULL CHECK(period_to>=period_from),
 model_version text NOT NULL CHECK(model_version ~ '^props-[a-z0-9-]+-v[0-9]+$'),
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object' AND length(report::text)<=100000),
 at timestamptz NOT NULL DEFAULT public.props_now()
);

-- props_accounts is append-only, so activation is its own append-only log.
CREATE TABLE public.props_account_activations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id bigint NOT NULL REFERENCES public.props_accounts(id),
 active_from timestamptz NOT NULL,
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 100),
 at timestamptz NOT NULL DEFAULT public.props_now()
);
INSERT INTO public.props_account_activations(account_id,active_from,actor)
 SELECT id,'2026-11-07T00:00:00Z','system:migration' FROM public.props_accounts WHERE selection_version='props-select-v1';
INSERT INTO public.props_accounts(slug,platform,selection_version,initial_cents,stake_cents,max_entries_per_day,picks_per_entry)
 VALUES('props-prizepicks-v2','prizepicks','props-select-v2',50000,500,3,2),
       ('props-pick6-v2','pick6','props-select-v2',50000,500,3,2);

CREATE OR REPLACE FUNCTION public.props_record_entry(p_account bigint,p_run bigint,p_picks bigint[],
 p_entry_type text,p_payout_terms text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.props_accounts; k text; eid bigint; n integer; games integer; players integer; plats integer;
 first_lock timestamptz; today integer; avail bigint;
BEGIN
 SELECT * INTO STRICT a FROM public.props_accounts WHERE id=p_account FOR UPDATE;
 PERFORM public.props_require_running(p_run);
 -- learning v1: an account records entries only after its activation (v2 accounts activate on the first learn promotion).
 IF NOT EXISTS(SELECT 1 FROM public.props_account_activations WHERE account_id=a.id AND active_from<=public.props_now()) THEN
  RAISE EXCEPTION 'PROPS_ACCOUNT_INACTIVE';
 END IF;
 IF p_picks IS NULL OR cardinality(p_picks)<>a.picks_per_entry OR
  (SELECT count(DISTINCT x) FROM unnest(p_picks) x)<>cardinality(p_picks) THEN RAISE EXCEPTION 'PROPS_ENTRY_SHAPE'; END IF;
 k:=encode(sha256(convert_to(a.slug||':'||(SELECT string_agg(x::text,',' ORDER BY x) FROM unnest(p_picks) x),'UTF8')),'hex');
 SELECT id INTO eid FROM public.props_entries WHERE entry_key=k;
 IF FOUND THEN RETURN jsonb_build_object('outcome','DUPLICATE','entryId',eid); END IF;
 SELECT count(*),count(DISTINCT o.provider_event_id),count(DISTINCT lower(o.player_name)),
  count(*) FILTER (WHERE o.platform<>a.platform OR pk.status<>'recorded' OR pk.selection_version<>a.selection_version),
  min(o.lock_at)
  INTO n,games,players,plats,first_lock
  FROM public.props_picks pk JOIN public.props_predictions pr ON pr.id=pk.prediction_id
  JOIN public.props_observations o ON o.id=pr.observation_id WHERE pk.id=ANY(p_picks);
 IF n<>cardinality(p_picks) OR plats<>0 THEN RAISE EXCEPTION 'PROPS_ENTRY_INELIGIBLE_PICK'; END IF;
 IF games<>n OR players<>n THEN RAISE EXCEPTION 'PROPS_ENTRY_CORRELATED'; END IF;
 IF public.props_now()>=first_lock-interval '2 minutes' THEN RAISE EXCEPTION 'PROPS_ENTRY_AFTER_LOCK'; END IF;
 IF EXISTS(SELECT 1 FROM public.props_entry_legs WHERE pick_id=ANY(p_picks)) THEN RAISE EXCEPTION 'PROPS_PICK_ALREADY_ENTERED'; END IF;
 SELECT count(*) INTO today FROM public.props_entries WHERE account_id=a.id
  AND (created_at AT TIME ZONE 'America/New_York')::date=(public.props_now() AT TIME ZONE 'America/New_York')::date;
 IF today>=a.max_entries_per_day THEN RAISE EXCEPTION 'PROPS_ENTRY_DAILY_LIMIT'; END IF;
 SELECT a.initial_cents+coalesce((SELECT sum(s.profit_cents) FROM public.props_entry_settlements s
   JOIN public.props_entries e ON e.id=s.entry_id WHERE e.account_id=a.id AND s.profit_cents IS NOT NULL),0)
  -coalesce((SELECT sum(e.stake_cents) FROM public.props_entries e LEFT JOIN public.props_entry_settlements s
   ON s.entry_id=e.id WHERE e.account_id=a.id AND (s.entry_id IS NULL OR s.profit_cents IS NULL)),0) INTO avail;
 IF avail<a.stake_cents THEN RAISE EXCEPTION 'PROPS_ENTRY_BANKROLL'; END IF;
 INSERT INTO public.props_entries(account_id,run_id,entry_key,entry_type,pick_count,stake_cents,payout_terms_version,lock_at)
  VALUES(a.id,p_run,k,p_entry_type,n,a.stake_cents,p_payout_terms,first_lock) RETURNING id INTO eid;
 INSERT INTO public.props_entry_legs(entry_id,pick_id) SELECT eid,x FROM unnest(p_picks) x;
 RETURN jsonb_build_object('outcome','RECORDED','entryId',eid,'stakeCents',a.stake_cents);
END $$;

CREATE FUNCTION public.props_set_learning(p_learning boolean,p_auto boolean,p_actor text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record;
BEGIN
 LOCK TABLE public.props_model_control_log IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT c FROM public.props_model_control_log ORDER BY id DESC LIMIT 1;
 INSERT INTO public.props_model_control_log(active_model_version,previous_model_version,learning_enabled,auto_switch_enabled,changed_by,reason)
  VALUES(c.active_model_version,c.previous_model_version,p_learning,p_auto,p_actor,p_reason);
 RETURN jsonb_build_object('active',c.active_model_version,'learning',p_learning,'autoSwitch',p_auto);
END $$;

CREATE FUNCTION public.props_promote_model(p_version text,p_actor text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record; latest text;
BEGIN
 LOCK TABLE public.props_model_control_log IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT c FROM public.props_model_control_log ORDER BY id DESC LIMIT 1;
 IF c.active_model_version=p_version THEN RAISE EXCEPTION 'PROPS_MODEL_ALREADY_ACTIVE'; END IF;
 SELECT event INTO latest FROM public.props_model_events WHERE version=p_version ORDER BY id DESC LIMIT 1;
 IF latest IS DISTINCT FROM 'eligible' THEN RAISE EXCEPTION 'PROPS_MODEL_NOT_ELIGIBLE'; END IF;
 INSERT INTO public.props_model_control_log(active_model_version,previous_model_version,learning_enabled,auto_switch_enabled,changed_by,reason)
  VALUES(p_version,c.active_model_version,c.learning_enabled,c.auto_switch_enabled,p_actor,p_reason);
 INSERT INTO public.props_model_events(version,event,reason,actor) VALUES(p_version,'promoted',p_reason,p_actor);
 -- The first learning promotion opens the v2 virtual accounts; v1 keeps its own record.
 INSERT INTO public.props_account_activations(account_id,active_from,actor)
  SELECT a.id,public.props_now(),p_actor FROM public.props_accounts a
  WHERE a.selection_version='props-select-v2' AND NOT EXISTS(SELECT 1 FROM public.props_account_activations x WHERE x.account_id=a.id);
 RETURN jsonb_build_object('active',p_version,'previous',c.active_model_version);
END $$;

CREATE FUNCTION public.props_rollback_model(p_actor text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c record;
BEGIN
 LOCK TABLE public.props_model_control_log IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT c FROM public.props_model_control_log ORDER BY id DESC LIMIT 1;
 IF c.previous_model_version IS NULL THEN RAISE EXCEPTION 'PROPS_NO_PREVIOUS_MODEL'; END IF;
 INSERT INTO public.props_model_control_log(active_model_version,previous_model_version,learning_enabled,auto_switch_enabled,changed_by,reason)
  VALUES(c.previous_model_version,NULL,c.learning_enabled,c.auto_switch_enabled,p_actor,p_reason);
 IF EXISTS(SELECT 1 FROM public.props_model_artifacts WHERE version=c.active_model_version) THEN
  INSERT INTO public.props_model_events(version,event,reason,actor) VALUES(c.active_model_version,'rolled_back',p_reason,p_actor);
 END IF;
 RETURN jsonb_build_object('active',c.previous_model_version,'rolledBack',c.active_model_version);
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_model_artifacts','props_model_events','props_model_control_log','props_learning_reports','props_account_activations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.props_immutable()',t);
 END LOOP;
 -- The worker writes artifacts, events and reports directly; control and activations change only through RPCs.
 FOREACH t IN ARRAY ARRAY['props_model_artifacts','props_model_events','props_learning_reports'] LOOP
  EXECUTE format('GRANT INSERT ON public.%I TO service_role',t);
 END LOOP;
 REVOKE ALL ON public.props_model_control FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.props_model_control TO service_role;
 FOREACH t IN ARRAY ARRAY['props_set_learning(boolean,boolean,text,text)','props_promote_model(text,text,text)','props_rollback_model(text,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role',t);
 END LOOP;
END $$;
COMMIT;
