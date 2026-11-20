-- Generated with Supabase CLI migration new; private paper platform, no exchange access.
CREATE TABLE public.kalshi_platform_version(id boolean PRIMARY KEY DEFAULT true CHECK(id),version text NOT NULL);
INSERT INTO public.kalshi_platform_version VALUES(true,'kalshi-paper-platform-v1');
CREATE TABLE public.kalshi_weather_evidence(
 kind text NOT NULL CHECK(kind IN ('forecast','outcome')),climate_date date NOT NULL,
 archive_ref text NOT NULL CHECK(archive_ref ~ '^[a-f0-9]{40}$'),blob_sha text NOT NULL CHECK(blob_sha ~ '^[a-f0-9]{40}$'),
 document text NOT NULL CHECK(octet_length(document)<=120000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(kind,climate_date),CHECK(jsonb_typeof(document::jsonb)='object')
);
CREATE TABLE public.kalshi_contract_forecasts(
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),model_id text NOT NULL,target_date date NOT NULL,
 as_of timestamptz NOT NULL,document text NOT NULL CHECK(octet_length(document)<=120000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(model_id,target_date),
 CHECK(document::jsonb->>'marketDataUsed' IS NOT DISTINCT FROM 'false'),
 CHECK(document::jsonb->>'id' IS NOT DISTINCT FROM id),CHECK(document::jsonb->>'modelId' IS NOT DISTINCT FROM model_id),
 CHECK(document::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'kalshi-weather-contract-forecast-v1')
);
CREATE TABLE public.kalshi_contract_grades(
 forecast_id text NOT NULL REFERENCES public.kalshi_contract_forecasts(id),source_id text NOT NULL,
 document text NOT NULL CHECK(octet_length(document)<=120000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(forecast_id,source_id)
);
CREATE TABLE public.kalshi_fixture_ledgers(
 study_id text NOT NULL CHECK(study_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
 revision integer NOT NULL CHECK(revision>0),document text NOT NULL CHECK(octet_length(document)<=2000000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(study_id,revision),
 CHECK(jsonb_typeof(document::jsonb)='array'),
 CHECK(document::jsonb#>>'{0,payload,config,mode}' IS NOT DISTINCT FROM 'OFFLINE_FIXTURE')
);
CREATE TABLE public.kalshi_platform_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slot text NOT NULL,attempt integer NOT NULL,
 token uuid NOT NULL DEFAULT gen_random_uuid(),started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz NOT NULL,finished_at timestamptz,
 status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','BLOCKED','FAILED')),
 summary jsonb NOT NULL DEFAULT '{}',UNIQUE(slot,attempt)
);
CREATE TABLE public.kalshi_demo_control(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),state text NOT NULL CHECK(state IN ('STOPPED','ARMED')),
 key_fingerprint text CHECK(key_fingerprint ~ '^[a-f0-9]{64}$'),
 checked_at timestamptz,changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.kalshi_demo_control(id,state) VALUES(true,'STOPPED');
CREATE TABLE public.kalshi_demo_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticker text NOT NULL UNIQUE CHECK(ticker ~ '^KXHIGHNY-[A-Z0-9.-]{5,80}$'),
 side text NOT NULL CHECK(side IN ('yes','no')),price_micros bigint NOT NULL CHECK(price_micros BETWEEN 10000 AND 990000 AND price_micros%10000=0),
 max_debit_micros bigint NOT NULL CHECK(max_debit_micros=price_micros+100000),
 kind text NOT NULL CHECK(kind IN ('MODEL','SMOKE')),key_fingerprint text NOT NULL,
 decision_document text NOT NULL CHECK(octet_length(decision_document)<=120000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),close_at timestamptz NOT NULL
);
CREATE TABLE public.kalshi_demo_receipts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,intent_id uuid NOT NULL REFERENCES public.kalshi_demo_intents(id),
 kind text NOT NULL CHECK(kind IN ('ACKNOWLEDGED','REJECTED','OUTCOME_UNKNOWN','RECONCILED','SETTLED')),
 document text NOT NULL CHECK(octet_length(document)<=120000),document_sha text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(intent_id,kind,document_sha)
);
CREATE TABLE public.kalshi_demo_account_snapshots(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,key_fingerprint text NOT NULL,
 document text NOT NULL CHECK(octet_length(document)<=120000),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.kalshi_platform_runs(started_at DESC);
CREATE INDEX ON public.kalshi_demo_intents(created_at DESC);
CREATE INDEX ON public.kalshi_demo_receipts(intent_id,id DESC);

CREATE FUNCTION public.kalshi_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'KALSHI_IMMUTABLE'; END $$;
CREATE FUNCTION public.kalshi_receipt_digest() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.document_sha:=encode(sha256(convert_to(NEW.document,'UTF8')),'hex'); RETURN NEW; END $$;
CREATE TRIGGER receipt_digest BEFORE INSERT ON public.kalshi_demo_receipts FOR EACH ROW EXECUTE FUNCTION public.kalshi_receipt_digest();
DO $lockdown$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['kalshi_platform_version','kalshi_weather_evidence','kalshi_contract_forecasts',
 'kalshi_contract_grades','kalshi_fixture_ledgers','kalshi_platform_runs','kalshi_demo_control',
 'kalshi_demo_intents','kalshi_demo_receipts','kalshi_demo_account_snapshots'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
  EXECUTE format('GRANT SELECT, INSERT ON public.%I TO service_role',t);
  IF t NOT IN ('kalshi_platform_runs','kalshi_demo_control') THEN
   EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.kalshi_immutable()',t);
  END IF;
 END LOOP;
END $lockdown$;
GRANT UPDATE ON public.kalshi_platform_runs,public.kalshi_demo_control TO service_role;
REVOKE ALL ON SEQUENCE public.kalshi_demo_receipts_id_seq,public.kalshi_demo_account_snapshots_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE,SELECT ON SEQUENCE public.kalshi_demo_receipts_id_seq,public.kalshi_demo_account_snapshots_id_seq TO service_role;

CREATE FUNCTION public.kalshi_begin_run(p_slot text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE old public.kalshi_platform_runs; fresh public.kalshi_platform_runs; n timestamptz;
BEGIN
 IF p_slot !~ '^(tick|owner)-[0-9TZ:.-]{13,40}$' THEN RAISE EXCEPTION 'KALSHI_BAD_SLOT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('kalshi-platform:'||p_slot,0)); n:=clock_timestamp();
 SELECT * INTO old FROM public.kalshi_platform_runs WHERE slot=p_slot ORDER BY attempt DESC LIMIT 1;
 IF old.id IS NOT NULL AND (old.status='COMPLETED' OR (old.status='RUNNING' AND old.lease_until>n)) THEN
  RETURN jsonb_build_object('claimed',false,'status',old.status); END IF;
 INSERT INTO public.kalshi_platform_runs(slot,attempt,started_at,lease_until,status)
 VALUES(p_slot,coalesce(old.attempt,0)+1,n,n+interval '90 seconds','RUNNING') RETURNING * INTO fresh;
 RETURN jsonb_build_object('claimed',true,'id',fresh.id,'token',fresh.token);
END $$;
CREATE FUNCTION public.kalshi_finish_run(p_id uuid,p_token uuid,p_status text,p_summary jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_status NOT IN ('COMPLETED','BLOCKED','FAILED') OR octet_length(p_summary::text)>20000 THEN RAISE EXCEPTION 'KALSHI_BAD_FINISH'; END IF;
 UPDATE public.kalshi_platform_runs SET status=p_status,summary=p_summary,finished_at=clock_timestamp()
 WHERE id=p_id AND token=p_token AND status='RUNNING' AND lease_until>=clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'KALSHI_LEASE_LOST'; END IF;
END $$;
CREATE FUNCTION public.kalshi_record_contract_forecast(p_document text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE d jsonb:=p_document::jsonb; old public.kalshi_contract_forecasts; n timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('kalshi-forecast:'||(d->>'modelId')||':'||(d#>>'{input,targetLocalDate}'),0)); n:=clock_timestamp();
 SELECT * INTO old FROM public.kalshi_contract_forecasts WHERE model_id=d->>'modelId' AND target_date=(d#>>'{input,targetLocalDate}')::date;
 IF old.id IS NOT NULL THEN RETURN old.id; END IF;
 IF (d->>'asOf')::timestamptz>n+interval '5 seconds' OR (d->>'asOf')::timestamptz<n-interval '120 seconds'
 OR (d#>>'{input,targetLocalDate}')::date <= (n AT TIME ZONE 'Etc/GMT+5')::date THEN RAISE EXCEPTION 'KALSHI_NOT_FORWARD'; END IF;
 INSERT INTO public.kalshi_contract_forecasts(id,model_id,target_date,as_of,document,recorded_at)
 VALUES(d->>'id',d->>'modelId',(d#>>'{input,targetLocalDate}')::date,(d->>'asOf')::timestamptz,p_document,n);
 RETURN d->>'id';
END $$;
CREATE FUNCTION public.kalshi_save_fixture_ledger(p_study text,p_expected_revision integer,p_document text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE old public.kalshi_fixture_ledgers; d jsonb:=p_document::jsonb; n integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('kalshi-fixture:'||p_study,0));
 SELECT * INTO old FROM public.kalshi_fixture_ledgers WHERE study_id=p_study ORDER BY revision DESC LIMIT 1;
 IF old.document::jsonb=d THEN RETURN old.revision; END IF;
 IF coalesce(old.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'KALSHI_REVISION_CONFLICT'; END IF;
 IF jsonb_typeof(d)<>'array' OR jsonb_array_length(d)<1 OR jsonb_array_length(d)>10000
 OR d#>>'{0,payload,config,id}' IS DISTINCT FROM p_study OR d#>>'{0,payload,config,mode}' IS DISTINCT FROM 'OFFLINE_FIXTURE' THEN RAISE EXCEPTION 'KALSHI_FIXTURE_ONLY'; END IF;
 IF old.revision IS NOT NULL THEN
  IF jsonb_array_length(d)<jsonb_array_length(old.document::jsonb) THEN RAISE EXCEPTION 'KALSHI_IMMUTABLE'; END IF;
  FOR n IN 0..jsonb_array_length(old.document::jsonb)-1 LOOP
   IF d->n IS DISTINCT FROM old.document::jsonb->n THEN RAISE EXCEPTION 'KALSHI_IMMUTABLE'; END IF;
  END LOOP;
 END IF;
 INSERT INTO public.kalshi_fixture_ledgers(study_id,revision,document) VALUES(p_study,p_expected_revision+1,p_document);
 RETURN p_expected_revision+1;
END $$;
CREATE FUNCTION public.kalshi_set_demo_control(p_state text,p_fingerprint text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_state NOT IN ('ARMED','STOPPED') OR (p_state='ARMED' AND coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'KALSHI_BAD_CONTROL'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('kalshi-demo-control',0));
 UPDATE public.kalshi_demo_control SET state=p_state,key_fingerprint=CASE WHEN p_state='ARMED' THEN p_fingerprint ELSE key_fingerprint END,
 checked_at=CASE WHEN p_state='ARMED' THEN clock_timestamp() ELSE checked_at END,changed_at=clock_timestamp() WHERE id=true;
END $$;
CREATE FUNCTION public.kalshi_note_demo_check(p_fingerprint text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('kalshi-demo-control',0));
 UPDATE public.kalshi_demo_control SET checked_at=clock_timestamp()
 WHERE id=true AND state='ARMED' AND key_fingerprint=p_fingerprint;
 IF NOT FOUND THEN RAISE EXCEPTION 'KALSHI_DEMO_NOT_ARMED'; END IF;
END $$;
CREATE FUNCTION public.kalshi_claim_demo_intent(p_ticker text,p_side text,p_price bigint,p_close timestamptz,p_kind text,p_fingerprint text,p_decision text) RETURNS public.kalshi_demo_intents LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c public.kalshi_demo_control; n timestamptz; answer public.kalshi_demo_intents; today date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('kalshi-demo-control',0)); n:=clock_timestamp(); today:=(n AT TIME ZONE 'Etc/GMT+5')::date;
 SELECT * INTO c FROM public.kalshi_demo_control WHERE id=true;
 IF p_decision IS NULL OR p_decision::jsonb->>'source' IS DISTINCT FROM 'KALSHI_DEMO'
 OR p_decision::jsonb->>'ticker' IS DISTINCT FROM p_ticker THEN RAISE EXCEPTION 'KALSHI_DEMO_INVALID_DECISION'; END IF;
 IF c.state<>'ARMED' OR c.key_fingerprint IS DISTINCT FROM p_fingerprint OR c.checked_at<n-interval '26 hours' THEN RAISE EXCEPTION 'KALSHI_DEMO_NOT_ARMED'; END IF;
 IF p_close<=n+interval '5 minutes' THEN RAISE EXCEPTION 'KALSHI_DEMO_LOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM public.kalshi_demo_intents WHERE ticker=p_ticker) THEN RAISE EXCEPTION 'KALSHI_DEMO_ALREADY_ATTEMPTED'; END IF;
 IF EXISTS(SELECT 1 FROM public.kalshi_demo_intents i LEFT JOIN LATERAL
 (SELECT kind FROM public.kalshi_demo_receipts r WHERE r.intent_id=i.id ORDER BY r.id DESC LIMIT 1) r ON true
 WHERE i.key_fingerprint=p_fingerprint AND (r.kind IS NULL OR r.kind='OUTCOME_UNKNOWN')) THEN RAISE EXCEPTION 'KALSHI_DEMO_RECONCILE_REQUIRED'; END IF;
 IF (SELECT count(*) FROM public.kalshi_demo_intents WHERE (created_at AT TIME ZONE 'Etc/GMT+5')::date=today)>=3 THEN RAISE EXCEPTION 'KALSHI_DEMO_DAILY_LIMIT'; END IF;
 INSERT INTO public.kalshi_demo_intents(ticker,side,price_micros,max_debit_micros,kind,key_fingerprint,decision_document,created_at,close_at)
 VALUES(p_ticker,p_side,p_price,p_price+100000,p_kind,p_fingerprint,p_decision,n,p_close) RETURNING * INTO answer;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.kalshi_immutable() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kalshi_receipt_digest() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kalshi_begin_run(text),public.kalshi_finish_run(uuid,uuid,text,jsonb),
 public.kalshi_record_contract_forecast(text),public.kalshi_save_fixture_ledger(text,integer,text),
 public.kalshi_set_demo_control(text,text),public.kalshi_note_demo_check(text),public.kalshi_claim_demo_intent(text,text,bigint,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kalshi_begin_run(text),public.kalshi_finish_run(uuid,uuid,text,jsonb),
 public.kalshi_record_contract_forecast(text),public.kalshi_save_fixture_ledger(text,integer,text),
 public.kalshi_set_demo_control(text,text),public.kalshi_note_demo_check(text),public.kalshi_claim_demo_intent(text,text,bigint,timestamptz,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
