-- SportsEdge AI Learning Lab v1 (2026-11-12). Additive, append-only, RESEARCH ONLY.
-- Frozen experiment registry, immutable forward predictions for every ablation variant, pre-lock risk flags and
-- comparison reports. Nothing here records a pick, an entry, a stake or a model switch, and nothing calls a provider:
-- the lab reuses lines and sportsbook quotes the collect run already stored (zero extra paid requests).
-- Requires props_v1.sql (props_now, props_immutable, props_observations, props_line_results).
BEGIN;

CREATE TABLE public.props_lab_experiments(
 id text PRIMARY KEY CHECK(id ~ '^lab-[a-z0-9-]+-v[0-9]+$'),
 spec_sha256 text NOT NULL UNIQUE CHECK(spec_sha256 ~ '^[a-f0-9]{64}$'),
 artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[a-f0-9]{64}$'),
 spec jsonb NOT NULL CHECK(jsonb_typeof(spec)='object' AND length(spec::text)<=60000 AND spec->>'researchOnly'='true'),
 registered_at timestamptz NOT NULL DEFAULT public.props_now()
);

CREATE TABLE public.props_lab_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES public.props_lab_experiments(id),
 event text NOT NULL CHECK(event IN ('registered','freeze_run','report','layer_accepted','layer_rejected','retired')),
 detail jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(detail)='object' AND length(detail::text)<=20000),
 actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 100),
 at timestamptz NOT NULL DEFAULT public.props_now()
);

-- One frozen forecast per (experiment, variant, line). First write wins; there is no update path.
CREATE TABLE public.props_lab_predictions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES public.props_lab_experiments(id),
 spec_sha256 text NOT NULL CHECK(spec_sha256 ~ '^[a-f0-9]{64}$'),
 variant_id text NOT NULL CHECK(variant_id ~ '^[a-z0-9+_-]{2,60}$'),
 observation_id bigint NOT NULL REFERENCES public.props_observations(id),
 p_more numeric NOT NULL CHECK(p_more BETWEEN 0 AND 1),
 p_less numeric NOT NULL CHECK(p_less BETWEEN 0 AND 1),
 p_tie numeric NOT NULL CHECK(p_tie BETWEEN 0 AND 1),
 data_cutoff timestamptz NOT NULL,
 inputs jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(inputs)='object' AND length(inputs::text)<=4000),
 predicted_at timestamptz NOT NULL DEFAULT public.props_now(),
 record_sha256 text,
 UNIQUE(experiment_id,variant_id,observation_id),
 CHECK(abs(p_more+p_less+p_tie-1)<0.000001)
);
CREATE INDEX props_lab_predictions_obs ON public.props_lab_predictions(observation_id);

-- Research-only pre-lock risk flags; recorded, evaluated later, never applied to picks.
CREATE TABLE public.props_lab_flags(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES public.props_lab_experiments(id),
 observation_id bigint NOT NULL REFERENCES public.props_observations(id),
 rules_version text NOT NULL CHECK(rules_version ~ '^lab-risk-flags-v[0-9]+$'),
 flags text[] NOT NULL DEFAULT '{}' CHECK(flags <@ ARRAY['insufficient_history','long_absence','minutes_shift','high_minutes_uncertainty',
  'books_disagree','large_line_gap','poor_category_calibration','same_game_exposure']::text[]),
 data_cutoff timestamptz NOT NULL,
 inputs jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(inputs)='object' AND length(inputs::text)<=4000),
 predicted_at timestamptz NOT NULL DEFAULT public.props_now(),
 UNIQUE(experiment_id,observation_id,rules_version)
);

CREATE TABLE public.props_lab_reports(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 experiment_id text NOT NULL REFERENCES public.props_lab_experiments(id),
 kind text NOT NULL CHECK(kind IN ('forward_comparison')),
 as_of timestamptz NOT NULL,
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object' AND length(report::text)<=400000),
 at timestamptz NOT NULL DEFAULT public.props_now()
);

-- Chronology: strictly before lock, data no later than the record time, never once any result exists,
-- and only under the experiment's registered spec. The content hash is computed by the database.
CREATE FUNCTION public.props_lab_check_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE lock timestamptz; registered text;
BEGIN
 NEW.predicted_at:=public.props_now();
 SELECT lock_at INTO STRICT lock FROM public.props_observations WHERE id=NEW.observation_id;
 IF NEW.predicted_at>=lock OR NEW.data_cutoff>NEW.predicted_at OR NEW.data_cutoff>=lock THEN
  RAISE EXCEPTION 'PROPS_LAB_AFTER_LOCK';
 END IF;
 IF EXISTS(SELECT 1 FROM public.props_line_results WHERE observation_id=NEW.observation_id) THEN
  RAISE EXCEPTION 'PROPS_LAB_RESULT_KNOWN';
 END IF;
 IF TG_TABLE_NAME='props_lab_predictions' THEN
  SELECT spec_sha256 INTO STRICT registered FROM public.props_lab_experiments WHERE id=NEW.experiment_id;
  IF registered<>NEW.spec_sha256 THEN RAISE EXCEPTION 'PROPS_LAB_SPEC_MISMATCH'; END IF;
  NEW.record_sha256:=encode(sha256(convert_to(concat_ws('|',NEW.experiment_id,NEW.spec_sha256,NEW.variant_id,NEW.observation_id::text,
   NEW.p_more::text,NEW.p_less::text,NEW.p_tie::text,to_char(NEW.data_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
   to_char(NEW.predicted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),NEW.inputs::text),'UTF8')),'hex');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER props_lab_prediction_chronology BEFORE INSERT ON public.props_lab_predictions
 FOR EACH ROW EXECUTE FUNCTION public.props_lab_check_frozen();
CREATE TRIGGER props_lab_flag_chronology BEFORE INSERT ON public.props_lab_flags
 FOR EACH ROW EXECUTE FUNCTION public.props_lab_check_frozen();

-- Integrity check: every stored forecast whose content no longer matches its hash (expected: none).
CREATE VIEW public.props_lab_prediction_tampering WITH (security_invoker=true) AS
 SELECT id,experiment_id,variant_id,observation_id FROM public.props_lab_predictions
 WHERE record_sha256 IS DISTINCT FROM encode(sha256(convert_to(concat_ws('|',experiment_id,spec_sha256,variant_id,observation_id::text,
   p_more::text,p_less::text,p_tie::text,to_char(data_cutoff AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
   to_char(predicted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),inputs::text),'UTF8')),'hex');

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_lab_experiments','props_lab_events','props_lab_predictions','props_lab_flags','props_lab_reports'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.props_immutable()',t);
 END LOOP;
 REVOKE ALL ON public.props_lab_prediction_tampering FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.props_lab_prediction_tampering TO service_role;
 REVOKE ALL ON FUNCTION public.props_lab_check_frozen() FROM PUBLIC,anon,authenticated;
END $$;
COMMIT;
