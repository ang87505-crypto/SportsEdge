-- Created with Supabase CLI migration new: 20261119234934_props_penny_paper_v1.
-- Separate, append-only, forward PAPER experiment. No original entry/stake/model is modified.
-- All sizing and settlement values are computed inside the database from immutable source rows.
BEGIN;
CREATE TABLE public.props_penny_cohorts(
 id text PRIMARY KEY CHECK(id='penny-paper-entry-v1'),
 policy_sha256 text NOT NULL CHECK(policy_sha256='0b79bd54409a9dd01d14c1c208263c3ecb8f0f08e05db5434e4822346716e68b'),
 policy jsonb NOT NULL CHECK(policy='{"comparison":"same_entries_flat_ten_cents","dailyRiskCents":1500,"dependenceHaircutPercent":2,"entryType":"two_pick_power_different_games","fractionalCentReturn":"floor","grossMultiplierMilli":3000,"id":"penny-paper-entry-v1","initialCents":50000,"maxStakeCents":50,"paperOnly":true,"probabilityBasis":"recorded_model_estimate_not_calibrated","probabilityScale":1000000,"promotion":"none","referenceStakeCents":10,"sizingPolicy":"penny-excess-probability-v1","termsVersion":"prizepicks-power-standard-20261107","version":1}'::jsonb),
 registered_at timestamptz NOT NULL DEFAULT public.props_now()
);
CREATE FUNCTION public.props_penny_cohort_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.registered_at:=public.props_now(); RETURN NEW; END $$;
CREATE TRIGGER props_penny_cohort_clock BEFORE INSERT ON public.props_penny_cohorts
 FOR EACH ROW EXECUTE FUNCTION public.props_penny_cohort_guard();

CREATE TABLE public.props_penny_entries(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cohort_id text NOT NULL REFERENCES public.props_penny_cohorts(id),
 source_entry_id bigint NOT NULL REFERENCES public.props_entries(id),
 probability_ppm integer CHECK(probability_ppm BETWEEN 0 AND 1000000),
 payout_multiplier_milli integer CHECK(payout_multiplier_milli=3000),
 stake_cents integer NOT NULL CHECK(stake_cents BETWEEN 0 AND 50),
 reference_stake_cents integer NOT NULL CHECK(reference_stake_cents BETWEEN 0 AND 10),
 reason text NOT NULL CHECK(reason IN ('SIZED','BELOW_BREAK_EVEN','NO_ROOM','PAYOUT_UNKNOWN','DEPENDENCE_UNKNOWN','PLAYER_DUPLICATE','TERMS_MISMATCH')),
 lock_at timestamptz NOT NULL,
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object' AND length(inputs::text)<12000),
 recorded_at timestamptz NOT NULL DEFAULT public.props_now(),
 record_sha256 text NOT NULL CHECK(record_sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(cohort_id,source_entry_id)
);
CREATE INDEX props_penny_source_entry ON public.props_penny_entries(source_entry_id);
CREATE TABLE public.props_penny_settlements(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 penny_entry_id bigint NOT NULL REFERENCES public.props_penny_entries(id),
 revision integer NOT NULL CHECK(revision>=1),
 grade_ids bigint[] NOT NULL CHECK(cardinality(grade_ids)=2),
 outcome text NOT NULL CHECK(outcome IN ('won','lost','refund','payout_unknown')),
 multiplier_milli integer CHECK(multiplier_milli IN (0,1000,1500,3000)),
 return_cents integer CHECK(return_cents>=0),profit_cents integer,
 reference_return_cents integer CHECK(reference_return_cents>=0),reference_profit_cents integer,
 recorded_at timestamptz NOT NULL DEFAULT public.props_now(),
 record_sha256 text NOT NULL CHECK(record_sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(penny_entry_id,revision),UNIQUE(penny_entry_id,grade_ids),
 CHECK((outcome='payout_unknown')=(return_cents IS NULL)),
 CHECK((return_cents IS NULL)=(profit_cents IS NULL)),
 CHECK((reference_return_cents IS NULL)=(reference_profit_cents IS NULL))
);

CREATE FUNCTION public.props_penny_entry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.props_penny_cohorts; src public.props_entries; platform text;
 leg record; legs jsonb:='[]'; n integer:=0; games text[]:='{}'; players text[]:='{}';
 product numeric:=1; first_lock timestamptz; eligible boolean:=true; raw_stake integer:=0;
 available bigint; reference_available bigint; used bigint; reference_used bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('props-penny:'||NEW.cohort_id,0));
 NEW.recorded_at:=public.props_now();
 SELECT * INTO STRICT c FROM public.props_penny_cohorts WHERE id=NEW.cohort_id;
 SELECT * INTO STRICT src FROM public.props_entries WHERE id=NEW.source_entry_id;
 IF src.created_at<c.registered_at OR src.created_at>NEW.recorded_at THEN RAISE EXCEPTION 'PROPS_PENNY_BEFORE_COHORT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.props_control WHERE id=1 AND state='RUNNING') THEN RAISE EXCEPTION 'PROPS_PENNY_PAUSED'; END IF;
 SELECT a.platform INTO STRICT platform FROM public.props_accounts a WHERE a.id=src.account_id;
 FOR leg IN SELECT k.id AS pick_id,k.side,k.status AS pick_status,k.decided_at,p.id AS prediction_id,p.status AS prediction_status,
   p.model_version,p.athlete_id,p.predicted_at,p.data_cutoff,p.p_more,p.p_less,p.p_tie,o.id AS observation_id,o.provider_event_id,o.player_name,o.lock_at,o.ingested_at,
   CASE WHEN k.side='more' THEN p.p_more ELSE p.p_less END AS probability
  FROM public.props_entry_legs l JOIN public.props_picks k ON k.id=l.pick_id JOIN public.props_predictions p ON p.id=k.prediction_id
  JOIN public.props_observations o ON o.id=p.observation_id WHERE l.entry_id=src.id ORDER BY k.id
 LOOP
  n:=n+1;first_lock:=least(first_lock,leg.lock_at);
  IF leg.pick_status<>'recorded' OR leg.prediction_status<>'scored' OR leg.probability IS NULL OR leg.side IS NULL OR leg.athlete_id IS NULL
   OR leg.predicted_at>NEW.recorded_at OR leg.decided_at>NEW.recorded_at OR leg.data_cutoff>leg.predicted_at
   OR leg.predicted_at>=leg.lock_at OR leg.decided_at>=leg.lock_at THEN RAISE EXCEPTION 'PROPS_PENNY_INVALID_SOURCE'; END IF;
  IF EXISTS(SELECT 1 FROM public.props_line_results WHERE observation_id=leg.observation_id) THEN RAISE EXCEPTION 'PROPS_PENNY_RESULT_KNOWN'; END IF;
  product:=product*floor(leg.probability*1000000);
  games:=array_append(games,leg.provider_event_id);players:=array_append(players,leg.athlete_id);
  legs:=legs||jsonb_build_array(to_jsonb(leg));
 END LOOP;
 IF n<>2 OR src.pick_count<>2 THEN RAISE EXCEPTION 'PROPS_PENNY_TWO_LEGS_REQUIRED'; END IF;
 NEW.lock_at:=least(first_lock,src.lock_at);
 IF NEW.recorded_at>=NEW.lock_at THEN RAISE EXCEPTION 'PROPS_PENNY_AFTER_LOCK'; END IF;
 NEW.probability_ppm:=NULL;NEW.payout_multiplier_milli:=NULL;NEW.reason:='SIZED';
 IF platform<>'prizepicks' OR src.entry_type<>'power' THEN NEW.reason:='PAYOUT_UNKNOWN';eligible:=false;
 ELSIF src.payout_terms_version IS DISTINCT FROM 'prizepicks-power-standard-20261107' THEN NEW.reason:='TERMS_MISMATCH';eligible:=false;
 ELSIF games[1]=games[2] THEN NEW.reason:='DEPENDENCE_UNKNOWN';eligible:=false;
 ELSIF players[1]=players[2] THEN NEW.reason:='PLAYER_DUPLICATE';eligible:=false;
 END IF;
 IF eligible THEN
  NEW.probability_ppm:=floor(product*98/100000000)::integer;NEW.payout_multiplier_milli:=3000;
  raw_stake:=greatest(0,floor((NEW.probability_ppm::bigint*3000-1000000000)::numeric/30000000)::integer);
 END IF;
 WITH latest AS (SELECT DISTINCT ON (penny_entry_id) * FROM public.props_penny_settlements ORDER BY penny_entry_id,revision DESC)
 SELECT 50000+coalesce(sum(s.profit_cents),0)-coalesce(sum(CASE WHEN s.profit_cents IS NULL THEN e.stake_cents ELSE 0 END),0),
  50000+coalesce(sum(s.reference_profit_cents),0)-coalesce(sum(CASE WHEN s.reference_profit_cents IS NULL THEN e.reference_stake_cents ELSE 0 END),0),
  coalesce(sum(e.stake_cents) FILTER(WHERE (e.recorded_at AT TIME ZONE 'America/New_York')::date=(NEW.recorded_at AT TIME ZONE 'America/New_York')::date),0),
  coalesce(sum(e.reference_stake_cents) FILTER(WHERE (e.recorded_at AT TIME ZONE 'America/New_York')::date=(NEW.recorded_at AT TIME ZONE 'America/New_York')::date),0)
 INTO available,reference_available,used,reference_used FROM public.props_penny_entries e LEFT JOIN latest s ON s.penny_entry_id=e.id WHERE e.cohort_id=c.id;
 NEW.stake_cents:=least(raw_stake,50,greatest(0,available),greatest(0,1500-used));
 NEW.reference_stake_cents:=CASE WHEN eligible THEN least(10,greatest(0,reference_available),greatest(0,1500-reference_used)) ELSE 0 END;
 IF eligible THEN NEW.reason:=CASE WHEN raw_stake=0 THEN 'BELOW_BREAK_EVEN' WHEN NEW.stake_cents=0 THEN 'NO_ROOM' ELSE 'SIZED' END; END IF;
 NEW.inputs:=jsonb_build_object('policySha256',c.policy_sha256,'probabilityBasis','recorded_model_estimate_not_calibrated',
  'haircutPercent',2,'legs',legs,'availableCents',available,'usedTodayCents',used,
  'referenceAvailableCents',reference_available,'referenceUsedTodayCents',reference_used);
 NEW.record_sha256:=encode(sha256(convert_to((to_jsonb(NEW)-'record_sha256')::text,'UTF8')),'hex');RETURN NEW;
END $$;
CREATE TRIGGER props_penny_freeze BEFORE INSERT ON public.props_penny_entries FOR EACH ROW EXECUTE FUNCTION public.props_penny_entry_guard();

CREATE FUNCTION public.props_penny_settlement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.props_penny_entries; expected bigint[]; wins integer; losses integer; m integer;
BEGIN
 SELECT * INTO STRICT e FROM public.props_penny_entries WHERE id=NEW.penny_entry_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('props-penny:'||e.cohort_id,0));
 NEW.recorded_at:=public.props_now();
 IF NEW.recorded_at<e.lock_at THEN RAISE EXCEPTION 'PROPS_PENNY_BEFORE_LOCK'; END IF;
 SELECT array_agg(r.id ORDER BY k.id),count(*) FILTER(WHERE r.outcome=k.side),count(*) FILTER(WHERE r.outcome IN ('more','less') AND r.outcome<>k.side)
 INTO expected,wins,losses FROM public.props_entry_legs l JOIN public.props_picks k ON k.id=l.pick_id
 JOIN public.props_predictions p ON p.id=k.prediction_id
 JOIN LATERAL(SELECT x.id,x.outcome FROM public.props_line_results x WHERE x.observation_id=p.observation_id AND x.graded_at<=NEW.recorded_at ORDER BY x.revision DESC LIMIT 1) r ON true
 WHERE l.entry_id=e.source_entry_id;
 IF cardinality(expected) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'PROPS_PENNY_RESULTS_PENDING'; END IF;
 IF NEW.grade_ids IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PROPS_PENNY_GRADE_MISMATCH'; END IF;
 SELECT coalesce(max(revision),0)+1 INTO NEW.revision FROM public.props_penny_settlements WHERE penny_entry_id=e.id;
 NEW.outcome:='payout_unknown';NEW.multiplier_milli:=NULL;NEW.return_cents:=NULL;NEW.profit_cents:=NULL;
 NEW.reference_return_cents:=NULL;NEW.reference_profit_cents:=NULL;
 IF e.payout_multiplier_milli IS NOT NULL THEN
  m:=CASE WHEN losses>0 THEN 0 WHEN wins=2 THEN 3000 WHEN wins=1 THEN 1500 ELSE 1000 END;
  NEW.outcome:=CASE WHEN m=0 THEN 'lost' WHEN m=1000 THEN 'refund' ELSE 'won' END;NEW.multiplier_milli:=m;
  NEW.return_cents:=floor(e.stake_cents*m::numeric/1000);NEW.profit_cents:=NEW.return_cents-e.stake_cents;
  NEW.reference_return_cents:=floor(e.reference_stake_cents*m::numeric/1000);NEW.reference_profit_cents:=NEW.reference_return_cents-e.reference_stake_cents;
 END IF;
 NEW.record_sha256:=encode(sha256(convert_to((to_jsonb(NEW)-'record_sha256')::text,'UTF8')),'hex');RETURN NEW;
END $$;
CREATE TRIGGER props_penny_grade BEFORE INSERT ON public.props_penny_settlements FOR EACH ROW EXECUTE FUNCTION public.props_penny_settlement_guard();
CREATE VIEW public.props_penny_tampering WITH(security_invoker=true) AS
 SELECT 'entry'::text AS kind,id FROM public.props_penny_entries e WHERE record_sha256 IS DISTINCT FROM encode(sha256(convert_to((to_jsonb(e)-'record_sha256')::text,'UTF8')),'hex')
 UNION ALL SELECT 'settlement',id FROM public.props_penny_settlements s WHERE record_sha256 IS DISTINCT FROM encode(sha256(convert_to((to_jsonb(s)-'record_sha256')::text,'UTF8')),'hex');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_penny_cohorts','props_penny_entries','props_penny_settlements'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.props_immutable()',t);
 END LOOP;
 REVOKE ALL ON public.props_penny_tampering FROM PUBLIC,anon,authenticated,service_role;
 GRANT SELECT ON public.props_penny_tampering TO service_role;
 REVOKE ALL ON FUNCTION public.props_penny_cohort_guard(),public.props_penny_entry_guard(),public.props_penny_settlement_guard() FROM PUBLIC,anon,authenticated;
 GRANT USAGE,SELECT ON SEQUENCE public.props_penny_entries_id_seq,public.props_penny_settlements_id_seq TO service_role;
END $$;
COMMIT;
