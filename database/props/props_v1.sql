-- SportsEdge NBA player-prop PAPER testing, schema v1 (additive).
-- Separate from the NBA moneyline research_* ledger and the stock paper_auto
-- schema: nothing here reads, alters or references those objects.
-- No function contacts a provider or a DFS platform; a server-side worker calls
-- these RPCs around each provider request. Only service_role may use them.
-- Evidence tables are append-only; a correction is a new row (revision), never an edit.
-- The experiment starts PAUSED: the owner must resume it explicitly.
BEGIN;

-- The single clock behind every chronology rule. Disposable test databases replace it.
CREATE FUNCTION public.props_now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$ SELECT clock_timestamp() $$;

CREATE FUNCTION public.props_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PROPS_IMMUTABLE: % rows are append-only',TG_TABLE_NAME; END $$;

-- ------------------------------------------------------------ control & runs
CREATE TABLE public.props_control(
 id smallint PRIMARY KEY CHECK(id=1),
 state text NOT NULL CHECK(state IN ('RUNNING','PAUSED','STOPPED')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
 changed_by text NOT NULL CHECK(changed_by ~ '^[a-z0-9:._-]{1,100}$'),
 changed_at timestamptz NOT NULL DEFAULT public.props_now(),
 version bigint NOT NULL DEFAULT 1
);
INSERT INTO public.props_control(id,state,reason,changed_by)
 VALUES(1,'PAUSED','Created paused: owner must verify configuration and resume','schema-v1');
CREATE TABLE public.props_control_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 state text NOT NULL, reason text NOT NULL, changed_by text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT public.props_now()
);

CREATE TABLE public.props_budget_policy(
 version text PRIMARY KEY CHECK(version ~ '^props-budget-v[0-9]+$'),
 daily_credits integer NOT NULL CHECK(daily_credits BETWEEN 1 AND 1000),
 monthly_credits integer NOT NULL CHECK(monthly_credits BETWEEN 1 AND 20000),
 provider_floor integer NOT NULL CHECK(provider_floor>=0),
 active_from timestamptz NOT NULL DEFAULT public.props_now()
);
-- 240/30d (existing NBA/EPL refresh) + 200/30d (props) <= 500/month; floor protects the refresh.
INSERT INTO public.props_budget_policy(version,daily_credits,monthly_credits,provider_floor)
 VALUES('props-budget-v1',12,200,60);

CREATE TABLE public.props_runs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('collect','settle','backfill')),
 slot_key text NOT NULL CHECK(slot_key ~ '^[0-9A-Za-z:._-]{4,80}$'),
 worker text NOT NULL CHECK(length(worker) BETWEEN 1 AND 100),
 status text NOT NULL CHECK(status IN ('running','completed','failed','skipped','abandoned')),
 scheduled_for timestamptz,
 started_at timestamptz NOT NULL DEFAULT public.props_now(),
 start_delay_seconds integer,
 heartbeat_at timestamptz NOT NULL DEFAULT public.props_now(),
 lease_until timestamptz NOT NULL,
 finished_at timestamptz,
 outcome text NOT NULL DEFAULT 'IN_PROGRESS' CHECK(outcome ~ '^[A-Z0-9_]{2,60}$'),
 summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(summary)='object' AND length(summary::text)<=20000),
 UNIQUE(kind,slot_key),
 CHECK((status='running')=(finished_at IS NULL))
);
-- At most one live run per kind (a second concurrent start is refused).
CREATE UNIQUE INDEX props_one_running_per_kind ON public.props_runs(kind) WHERE status='running';

-- ------------------------------------------------------------ provider budget
CREATE TABLE public.props_credit_reservations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 endpoint text NOT NULL CHECK(endpoint IN ('events','event_odds')),
 provider_event_id text CHECK(provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
 credits integer NOT NULL CHECK(credits BETWEEN 1 AND 50),
 policy_version text NOT NULL REFERENCES public.props_budget_policy(version),
 reserved_at timestamptz NOT NULL DEFAULT public.props_now()
);
CREATE INDEX props_credit_time ON public.props_credit_reservations(reserved_at);
CREATE TABLE public.props_provider_usage(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reservation_id bigint NOT NULL UNIQUE REFERENCES public.props_credit_reservations(id),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 requests_remaining integer CHECK(requests_remaining>=0),
 requests_used integer CHECK(requests_used>=0),
 requests_last integer CHECK(requests_last>=0),
 recorded_at timestamptz NOT NULL DEFAULT public.props_now()
);

-- ------------------------------------------------------------ evidence
CREATE TABLE public.props_raw_responses(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 source text NOT NULL CHECK(source IN ('the_odds_api','espn_summary','espn_scoreboard')),
 endpoint text NOT NULL CHECK(length(endpoint) BETWEEN 1 AND 40),
 external_id text NOT NULL CHECK(external_id ~ '^[A-Za-z0-9_:-]{1,80}$'),
 http_status integer NOT NULL CHECK(http_status BETWEEN 100 AND 599),
 received_at timestamptz NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 body jsonb NOT NULL CHECK(length(body::text)<=2000000),
 UNIQUE(source,endpoint,external_id,content_sha256)
);

CREATE TABLE public.props_observations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 raw_response_id bigint NOT NULL REFERENCES public.props_raw_responses(id),
 provider text NOT NULL CHECK(provider='the_odds_api'),
 platform text NOT NULL CHECK(platform IN ('prizepicks','pick6')),
 bookmaker_key text NOT NULL CHECK(bookmaker_key IN ('prizepicks','pick6')),
 provider_event_id text NOT NULL CHECK(provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
 home_team text NOT NULL, away_team text NOT NULL,
 commence_time timestamptz NOT NULL, lock_at timestamptz NOT NULL,
 player_name text NOT NULL CHECK(length(player_name) BETWEEN 1 AND 120),
 stat text NOT NULL CHECK(stat IN ('points','rebounds','assists')),
 market_key text NOT NULL CHECK(market_key IN ('player_points','player_rebounds','player_assists')),
 period text NOT NULL CHECK(period='full_game'),
 line numeric(5,1) NOT NULL CHECK(line>0 AND line<100 AND line*2=trunc(line*2)),
 over_price integer, under_price integer,
 over_multiplier numeric, under_multiplier numeric,
 provider_last_update timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT public.props_now(),
 normalizer_version text NOT NULL CHECK(normalizer_version ~ '^props-normalize-v[0-9]+$'),
 response_sha256 text NOT NULL CHECK(response_sha256 ~ '^[a-f0-9]{64}$'),
 source_fields jsonb NOT NULL CHECK(jsonb_typeof(source_fields)='object' AND length(source_fields::text)<=4000),
 is_fixture boolean NOT NULL DEFAULT false CHECK(is_fixture=false),
 CHECK(platform=bookmaker_key),
 CHECK(lock_at<=commence_time),
 CHECK(coalesce(over_multiplier,1)=1 AND coalesce(under_multiplier,1)=1),
 UNIQUE(platform,provider_event_id,market_key,player_name,line,provider_last_update)
);
CREATE INDEX props_obs_lock ON public.props_observations(lock_at);

-- Box-score evidence. A correction from the same source is a new revision.
CREATE TABLE public.props_player_games(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source text NOT NULL CHECK(source IN ('espn_summary','sportsdataverse_player_box')),
 espn_event_id text NOT NULL CHECK(espn_event_id ~ '^[0-9]{6,12}$'),
 athlete_id text NOT NULL CHECK(athlete_id ~ '^[0-9]{1,12}$'),
 athlete_name text NOT NULL CHECK(length(athlete_name) BETWEEN 1 AND 120),
 team_abbr text NOT NULL CHECK(team_abbr ~ '^[A-Z]{2,4}$'),
 opponent_abbr text NOT NULL CHECK(opponent_abbr ~ '^[A-Z]{2,4}$'),
 game_start timestamptz NOT NULL,
 game_status text NOT NULL CHECK(game_status IN ('final','postponed','canceled')),
 did_not_play boolean NOT NULL,
 dnp_reason text CHECK(length(dnp_reason)<=120),
 minutes numeric(5,2) CHECK(minutes BETWEEN 0 AND 80),
 points integer CHECK(points BETWEEN 0 AND 120),
 rebounds integer CHECK(rebounds BETWEEN 0 AND 60),
 assists integer CHECK(assists BETWEEN 0 AND 40),
 retrieved_at timestamptz NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 recorded_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(source,espn_event_id,athlete_id,revision),
 -- Missing data is never zero: a played final row has every graded stat.
 CHECK(game_status<>'final' OR did_not_play OR (minutes IS NOT NULL AND points IS NOT NULL AND rebounds IS NOT NULL AND assists IS NOT NULL)),
 CHECK(retrieved_at>game_start)
);
CREATE INDEX props_pg_athlete ON public.props_player_games(athlete_id,game_start);

-- Provider event -> ESPN event identity, verified by teams and start time.
CREATE TABLE public.props_game_links(
 provider_event_id text PRIMARY KEY CHECK(provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
 espn_event_id text NOT NULL UNIQUE CHECK(espn_event_id ~ '^[0-9]{6,12}$'),
 home_abbr text NOT NULL, away_abbr text NOT NULL,
 provider_start timestamptz NOT NULL, espn_start timestamptz NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT public.props_now(),
 CHECK(abs(extract(epoch FROM provider_start-espn_start))<=7200)
);

-- ------------------------------------------------------------ model output
CREATE TABLE public.props_predictions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 observation_id bigint NOT NULL REFERENCES public.props_observations(id),
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 model_version text NOT NULL CHECK(model_version ~ '^props-[a-z0-9-]+-v[0-9]+$'),
 status text NOT NULL CHECK(status IN ('scored','unscorable')),
 reason text NOT NULL CHECK(reason ~ '^[a-z0-9_]{2,60}$'),
 athlete_id text CHECK(athlete_id ~ '^[0-9]{1,12}$'),
 p_more numeric, p_less numeric, p_tie numeric, mean numeric,
 data_cutoff timestamptz NOT NULL,
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object' AND length(inputs::text)<=4000),
 predicted_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(observation_id,model_version),
 CHECK(status<>'scored' OR (athlete_id IS NOT NULL AND p_more BETWEEN 0 AND 1 AND p_less BETWEEN 0 AND 1
  AND p_tie BETWEEN 0 AND 1 AND abs(p_more+p_less+p_tie-1)<0.000001 AND mean>=0)),
 CHECK(status<>'unscorable' OR (p_more IS NULL AND p_less IS NULL AND p_tie IS NULL))
);

-- Selection decision for every scored line (recorded pick or explicit skip).
CREATE TABLE public.props_picks(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 prediction_id bigint NOT NULL REFERENCES public.props_predictions(id),
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 selection_version text NOT NULL CHECK(selection_version ~ '^props-select-v[0-9]+$'),
 status text NOT NULL CHECK(status IN ('recorded','skipped')),
 side text CHECK(side IN ('more','less')),
 reason text NOT NULL CHECK(reason ~ '^[a-z0-9_]{2,60}$'),
 decided_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(prediction_id,selection_version),
 CHECK((status='recorded')=(side IS NOT NULL))
);

-- ------------------------------------------------------------ virtual entries
CREATE TABLE public.props_accounts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK(slug ~ '^props-[a-z0-9-]+-v[0-9]+$'),
 platform text NOT NULL CHECK(platform IN ('prizepicks','pick6')),
 selection_version text NOT NULL,
 initial_cents bigint NOT NULL CHECK(initial_cents>0),
 stake_cents bigint NOT NULL CHECK(stake_cents BETWEEN 100 AND 2500),
 max_entries_per_day integer NOT NULL CHECK(max_entries_per_day BETWEEN 0 AND 10),
 picks_per_entry integer NOT NULL CHECK(picks_per_entry BETWEEN 2 AND 6),
 created_at timestamptz NOT NULL DEFAULT public.props_now()
);
INSERT INTO public.props_accounts(slug,platform,selection_version,initial_cents,stake_cents,max_entries_per_day,picks_per_entry)
 VALUES('props-prizepicks-v1','prizepicks','props-select-v1',50000,500,3,2),
       ('props-pick6-v1','pick6','props-select-v1',50000,500,3,2);

CREATE TABLE public.props_entries(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id bigint NOT NULL REFERENCES public.props_accounts(id),
 run_id bigint NOT NULL REFERENCES public.props_runs(id),
 entry_key text NOT NULL UNIQUE CHECK(entry_key ~ '^[a-f0-9]{64}$'),
 entry_type text NOT NULL CHECK(entry_type IN ('power','pick6_standard')),
 pick_count integer NOT NULL CHECK(pick_count BETWEEN 2 AND 6),
 stake_cents bigint NOT NULL CHECK(stake_cents>0),
 payout_terms_version text CHECK(payout_terms_version ~ '^[a-z0-9-]{3,60}$'),
 lock_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT public.props_now()
);
CREATE TABLE public.props_entry_legs(
 entry_id bigint NOT NULL REFERENCES public.props_entries(id),
 pick_id bigint NOT NULL UNIQUE REFERENCES public.props_picks(id),
 PRIMARY KEY(entry_id,pick_id)
);

-- ------------------------------------------------------------ results
CREATE TABLE public.props_line_results(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 observation_id bigint NOT NULL REFERENCES public.props_observations(id),
 player_game_id bigint REFERENCES public.props_player_games(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 actual numeric(6,1),
 outcome text NOT NULL CHECK(outcome IN ('more','less','tie','void_dnp','void_postponed')),
 graded_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(observation_id,revision),
 CHECK((outcome IN ('more','less','tie'))=(actual IS NOT NULL)),
 CHECK(outcome NOT IN ('more','less','tie') OR player_game_id IS NOT NULL)
);
CREATE TABLE public.props_entry_settlements(
 entry_id bigint PRIMARY KEY REFERENCES public.props_entries(id),
 outcome text NOT NULL CHECK(outcome IN ('won','lost','partial','refund','payout_unknown')),
 wins integer NOT NULL CHECK(wins>=0), losses integer NOT NULL CHECK(losses>=0),
 voids integer NOT NULL CHECK(voids>=0),
 multiplier_milli integer CHECK(multiplier_milli BETWEEN 0 AND 1000000),
 return_cents bigint CHECK(return_cents>=0),
 profit_cents bigint,
 payout_terms_version text,
 settled_at timestamptz NOT NULL DEFAULT public.props_now(),
 CHECK((outcome='payout_unknown')=(return_cents IS NULL)),
 CHECK((return_cents IS NULL)=(profit_cents IS NULL))
);

-- ------------------------------------------------------------ chronology guards
CREATE FUNCTION public.props_require_running(p_run bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r record;
BEGIN
 SELECT status,lease_until INTO r FROM public.props_runs WHERE id=p_run;
 IF NOT FOUND OR r.status<>'running' OR r.lease_until<=public.props_now() THEN
  RAISE EXCEPTION 'PROPS_RUN_NOT_ACTIVE';
 END IF;
END $$;

CREATE FUNCTION public.props_check_observation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.recorded_at:=public.props_now();
 -- Never store a pregame line at/after the deadline, and never backdate receipt.
 IF NEW.ingested_at>NEW.recorded_at OR NEW.ingested_at>=NEW.lock_at OR NEW.recorded_at>=NEW.lock_at
  OR NEW.provider_last_update>NEW.ingested_at+interval '60 seconds'
  OR NEW.provider_last_update<NEW.ingested_at-interval '2 hours'
  OR NEW.provider_last_update>=NEW.lock_at THEN
  RAISE EXCEPTION 'PROPS_OBSERVATION_CHRONOLOGY';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_observation_chronology BEFORE INSERT ON public.props_observations
 FOR EACH ROW EXECUTE FUNCTION public.props_check_observation();

CREATE FUNCTION public.props_check_prediction() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE lock timestamptz;
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.predicted_at:=public.props_now();
 SELECT lock_at INTO lock FROM public.props_observations WHERE id=NEW.observation_id;
 -- An after-lock prediction is refused, never relabelled as pregame.
 IF NEW.predicted_at>=lock OR NEW.data_cutoff>NEW.predicted_at OR NEW.data_cutoff>=lock THEN
  RAISE EXCEPTION 'PROPS_PREDICTION_AFTER_LOCK';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_prediction_chronology BEFORE INSERT ON public.props_predictions
 FOR EACH ROW EXECUTE FUNCTION public.props_check_prediction();

CREATE FUNCTION public.props_check_pick() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE lock timestamptz; st text;
BEGIN
 PERFORM public.props_require_running(NEW.run_id);
 NEW.decided_at:=public.props_now();
 SELECT o.lock_at,p.status INTO lock,st FROM public.props_predictions p
  JOIN public.props_observations o ON o.id=p.observation_id WHERE p.id=NEW.prediction_id;
 IF NEW.decided_at>=lock THEN RAISE EXCEPTION 'PROPS_PICK_AFTER_LOCK'; END IF;
 IF NEW.status='recorded' AND st<>'scored' THEN RAISE EXCEPTION 'PROPS_PICK_UNSCORED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_pick_chronology BEFORE INSERT ON public.props_picks
 FOR EACH ROW EXECUTE FUNCTION public.props_check_pick();

CREATE FUNCTION public.props_check_line_result() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o public.props_observations; g public.props_player_games;
BEGIN
 SELECT * INTO STRICT o FROM public.props_observations WHERE id=NEW.observation_id;
 IF public.props_now()<=o.lock_at THEN RAISE EXCEPTION 'PROPS_RESULT_BEFORE_LOCK'; END IF;
 IF NEW.player_game_id IS NOT NULL THEN
  SELECT * INTO STRICT g FROM public.props_player_games WHERE id=NEW.player_game_id;
  IF g.game_status<>'final' THEN RAISE EXCEPTION 'PROPS_RESULT_NOT_GRADABLE'; END IF;
  IF g.did_not_play<>(NEW.outcome='void_dnp') THEN RAISE EXCEPTION 'PROPS_RESULT_INCONSISTENT'; END IF;
  IF NOT g.did_not_play AND (NEW.actual IS DISTINCT FROM (CASE o.stat WHEN 'points' THEN g.points WHEN 'rebounds' THEN g.rebounds ELSE g.assists END)::numeric
   OR NEW.outcome<>(CASE WHEN NEW.actual>o.line THEN 'more' WHEN NEW.actual<o.line THEN 'less' ELSE 'tie' END)) THEN
   RAISE EXCEPTION 'PROPS_RESULT_INCONSISTENT';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_line_result_consistency BEFORE INSERT ON public.props_line_results
 FOR EACH ROW EXECUTE FUNCTION public.props_check_line_result();

-- ------------------------------------------------------------ RPCs
CREATE FUNCTION public.props_begin_run(p_kind text,p_slot text,p_worker text,
 p_scheduled_for timestamptz,p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.props_control; existing public.props_runs; rid bigint; now_ts timestamptz:=public.props_now();
 abandoned integer; delay integer;
BEGIN
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'PROPS_INVALID_LEASE'; END IF;
 SELECT * INTO STRICT c FROM public.props_control WHERE id=1 FOR UPDATE;  -- serialization point
 -- Recovery: a run whose lease lapsed (crash, cancelled job) is closed as abandoned.
 UPDATE public.props_runs SET status='abandoned',finished_at=now_ts,outcome='LEASE_EXPIRED'
  WHERE kind=p_kind AND status='running' AND lease_until<=now_ts;
 GET DIAGNOSTICS abandoned=ROW_COUNT;
 SELECT * INTO existing FROM public.props_runs WHERE kind=p_kind AND slot_key=p_slot;
 IF FOUND THEN RETURN jsonb_build_object('outcome','DUPLICATE','runId',existing.id,'status',existing.status); END IF;
 IF EXISTS(SELECT 1 FROM public.props_runs WHERE kind=p_kind AND status='running') THEN
  RETURN jsonb_build_object('outcome','BUSY','abandoned',abandoned);
 END IF;
 delay:=CASE WHEN p_scheduled_for IS NULL THEN NULL ELSE greatest(0,extract(epoch FROM now_ts-p_scheduled_for))::integer END;
 IF c.state<>'RUNNING' THEN
  INSERT INTO public.props_runs(kind,slot_key,worker,status,scheduled_for,start_delay_seconds,lease_until,finished_at,outcome)
   VALUES(p_kind,p_slot,p_worker,'skipped',p_scheduled_for,delay,now_ts,now_ts,'CONTROL_'||c.state) RETURNING id INTO rid;
  RETURN jsonb_build_object('outcome','CONTROL_'||c.state,'runId',rid,'abandoned',abandoned);
 END IF;
 INSERT INTO public.props_runs(kind,slot_key,worker,status,scheduled_for,start_delay_seconds,lease_until)
  VALUES(p_kind,p_slot,p_worker,'running',p_scheduled_for,delay,now_ts+make_interval(secs=>p_lease_seconds)) RETURNING id INTO rid;
 RETURN jsonb_build_object('outcome','STARTED','runId',rid,'abandoned',abandoned,'startDelaySeconds',delay);
END $$;

CREATE FUNCTION public.props_heartbeat(p_run bigint,p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st text;
BEGIN
 IF p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'PROPS_INVALID_LEASE'; END IF;
 SELECT state INTO st FROM public.props_control WHERE id=1;
 PERFORM public.props_require_running(p_run);
 UPDATE public.props_runs SET heartbeat_at=public.props_now(),
  lease_until=public.props_now()+make_interval(secs=>p_lease_seconds) WHERE id=p_run;
 RETURN jsonb_build_object('control',st);
END $$;

CREATE FUNCTION public.props_finish_run(p_run bigint,p_status text,p_outcome text,p_summary jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF p_status NOT IN ('completed','failed') THEN RAISE EXCEPTION 'PROPS_INVALID_STATUS'; END IF;
 UPDATE public.props_runs SET status=p_status,outcome=p_outcome,summary=coalesce(p_summary,'{}'::jsonb),
  finished_at=public.props_now(),heartbeat_at=public.props_now()
  WHERE id=p_run AND status='running';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'PROPS_RUN_NOT_ACTIVE'; END IF;
 RETURN jsonb_build_object('runId',p_run,'status',p_status);
END $$;

-- Conservative, atomic reservation BEFORE each provider request. Never refunded.
CREATE FUNCTION public.props_reserve_credits(p_run bigint,p_endpoint text,p_event text,p_credits integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.props_control; pol public.props_budget_policy; d bigint; m bigint; remaining integer; rid bigint;
BEGIN
 SELECT * INTO STRICT c FROM public.props_control WHERE id=1 FOR UPDATE;
 IF c.state<>'RUNNING' THEN RAISE EXCEPTION 'PROPS_CONTROL_%',c.state; END IF;
 PERFORM public.props_require_running(p_run);
 SELECT * INTO STRICT pol FROM public.props_budget_policy WHERE active_from<=public.props_now()
  ORDER BY active_from DESC LIMIT 1;
 SELECT coalesce(sum(credits) FILTER (WHERE reserved_at>public.props_now()-interval '24 hours'),0),
        coalesce(sum(credits) FILTER (WHERE reserved_at>public.props_now()-interval '30 days'),0)
  INTO d,m FROM public.props_credit_reservations;
 IF d+p_credits>pol.daily_credits THEN RAISE EXCEPTION 'PROPS_BUDGET_DAILY_CAP'; END IF;
 IF m+p_credits>pol.monthly_credits THEN RAISE EXCEPTION 'PROPS_BUDGET_MONTHLY_CAP'; END IF;
 SELECT u.requests_remaining INTO remaining FROM public.props_provider_usage u
  WHERE u.requests_remaining IS NOT NULL ORDER BY u.recorded_at DESC,u.id DESC LIMIT 1;
 IF remaining IS NOT NULL AND remaining-p_credits<pol.provider_floor THEN RAISE EXCEPTION 'PROPS_BUDGET_PROVIDER_FLOOR'; END IF;
 INSERT INTO public.props_credit_reservations(run_id,endpoint,provider_event_id,credits,policy_version)
  VALUES(p_run,p_endpoint,p_event,p_credits,pol.version) RETURNING id INTO rid;
 RETURN rid;
END $$;

CREATE FUNCTION public.props_record_usage(p_reservation bigint,p_http integer,p_remaining integer,p_used integer,p_last integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO public.props_provider_usage(reservation_id,http_status,requests_remaining,requests_used,requests_last)
 VALUES(p_reservation,p_http,p_remaining,p_used,p_last) ON CONFLICT(reservation_id) DO NOTHING
$$;

CREATE FUNCTION public.props_set_control(p_state text,p_reason text,p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v bigint;
BEGIN
 IF p_state NOT IN ('RUNNING','PAUSED','STOPPED') THEN RAISE EXCEPTION 'PROPS_INVALID_STATE'; END IF;
 UPDATE public.props_control SET state=p_state,reason=p_reason,changed_by=p_actor,
  changed_at=public.props_now(),version=version+1 WHERE id=1 RETURNING version INTO v;
 INSERT INTO public.props_control_log(state,reason,changed_by) VALUES(p_state,p_reason,p_actor);
 RETURN jsonb_build_object('state',p_state,'version',v);
END $$;

-- Atomic virtual entry: account lock, recorded pre-lock picks on this platform,
-- distinct games and players (documented correlation restriction), daily limit,
-- available virtual bankroll. Idempotent on the leg set.
CREATE FUNCTION public.props_record_entry(p_account bigint,p_run bigint,p_picks bigint[],
 p_entry_type text,p_payout_terms text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.props_accounts; k text; eid bigint; n integer; games integer; players integer; plats integer;
 first_lock timestamptz; today integer; avail bigint;
BEGIN
 SELECT * INTO STRICT a FROM public.props_accounts WHERE id=p_account FOR UPDATE;
 PERFORM public.props_require_running(p_run);
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

-- Settlement written by the worker after grading; the DB re-checks the counts
-- against the latest line results and the cent arithmetic. Immutable once written.
CREATE FUNCTION public.props_record_settlement(p_entry bigint,p_outcome text,p_multiplier_milli integer,
 p_return_cents bigint,p_terms text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.props_entries; w integer; l integer; v integer; missing integer;
BEGIN
 SELECT * INTO STRICT e FROM public.props_entries WHERE id=p_entry FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.props_entry_settlements WHERE entry_id=p_entry) THEN
  RETURN jsonb_build_object('outcome','DUPLICATE','entryId',p_entry);
 END IF;
 WITH latest AS (
  SELECT DISTINCT ON (lr.observation_id) lr.observation_id,lr.outcome FROM public.props_line_results lr
  ORDER BY lr.observation_id,lr.revision DESC)
 SELECT count(*) FILTER (WHERE r.outcome=pk.side),
        count(*) FILTER (WHERE r.outcome IN ('more','less') AND r.outcome<>pk.side),
        count(*) FILTER (WHERE r.outcome IN ('tie','void_dnp','void_postponed')),
        count(*) FILTER (WHERE r.outcome IS NULL)
  INTO w,l,v,missing
  FROM public.props_entry_legs g JOIN public.props_picks pk ON pk.id=g.pick_id
  JOIN public.props_predictions pr ON pr.id=pk.prediction_id
  LEFT JOIN latest r ON r.observation_id=pr.observation_id WHERE g.entry_id=p_entry;
 IF missing>0 THEN RAISE EXCEPTION 'PROPS_SETTLEMENT_UNGRADED_LEG'; END IF;
 IF p_outcome='payout_unknown' THEN
  IF p_return_cents IS NOT NULL OR p_multiplier_milli IS NOT NULL THEN RAISE EXCEPTION 'PROPS_SETTLEMENT_INCONSISTENT'; END IF;
 ELSIF p_return_cents IS NULL OR p_multiplier_milli IS NULL
  OR p_return_cents<>(e.stake_cents*p_multiplier_milli)/1000 OR (e.stake_cents*p_multiplier_milli)%1000<>0
  OR (p_outcome='lost' AND p_return_cents<>0) OR (p_outcome='refund' AND p_return_cents<>e.stake_cents)
  OR (p_outcome='won' AND (l>0 OR p_return_cents<=e.stake_cents)) THEN
  RAISE EXCEPTION 'PROPS_SETTLEMENT_INCONSISTENT';
 END IF;
 INSERT INTO public.props_entry_settlements(entry_id,outcome,wins,losses,voids,multiplier_milli,return_cents,profit_cents,payout_terms_version)
  VALUES(p_entry,p_outcome,w,l,v,p_multiplier_milli,p_return_cents,
   CASE WHEN p_return_cents IS NULL THEN NULL ELSE p_return_cents-e.stake_cents END,p_terms);
 RETURN jsonb_build_object('outcome','RECORDED','entryId',p_entry,'wins',w,'losses',l,'voids',v);
END $$;

-- ------------------------------------------------------------ privileges
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_control','props_control_log','props_budget_policy','props_runs',
  'props_credit_reservations','props_provider_usage','props_raw_responses','props_observations',
  'props_player_games','props_game_links','props_predictions','props_picks','props_accounts',
  'props_entries','props_entry_legs','props_line_results','props_entry_settlements'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
 END LOOP;
 -- Append-only evidence tables: service_role may insert; nobody may update or delete.
 FOREACH t IN ARRAY ARRAY['props_raw_responses','props_observations','props_player_games','props_game_links',
  'props_predictions','props_picks','props_line_results'] LOOP
  EXECUTE format('GRANT INSERT ON public.%I TO service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['props_control_log','props_budget_policy','props_credit_reservations','props_provider_usage',
  'props_raw_responses','props_observations','props_player_games','props_game_links','props_predictions',
  'props_picks','props_accounts','props_entries','props_entry_legs','props_line_results','props_entry_settlements'] LOOP
  EXECUTE format('CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.props_immutable()',t);
 END LOOP;
END $$;
-- service_role bypasses RLS on Supabase; RLS without policies still blocks anon/authenticated.
-- Only props_* functions are touched; existing public functions keep their grants.
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['props_now()','props_immutable()','props_require_running(bigint)','props_check_observation()',
  'props_check_prediction()','props_check_pick()','props_check_line_result()'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon,authenticated',f);
 END LOOP;
 FOREACH f IN ARRAY ARRAY['props_begin_run(text,text,text,timestamptz,integer)','props_heartbeat(bigint,integer)',
  'props_finish_run(bigint,text,text,jsonb)','props_reserve_credits(bigint,text,text,integer)',
  'props_record_usage(bigint,integer,integer,integer,integer)','props_set_control(text,text,text)',
  'props_record_entry(bigint,bigint,bigint[],text,text)','props_record_settlement(bigint,text,integer,bigint,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon,authenticated',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role',f);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.props_now(),public.props_require_running(bigint) TO service_role;
COMMIT;
