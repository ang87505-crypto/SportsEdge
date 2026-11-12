\set ON_ERROR_STOP on
-- props_lab_v1 contract tests (disposable DB; runs after props_v1_test.sql, so its helpers, observations and results exist).
-- Proves: forecasts are frozen before lock, can never be rewritten or deleted, are refused once a result exists,
-- are tied to the registered spec, and any out-of-band edit is visible in the tampering view.
SET ROLE service_role;
SELECT id AS graded FROM public.props_observations o WHERE EXISTS(SELECT 1 FROM public.props_line_results r WHERE r.observation_id=o.id) ORDER BY id LIMIT 1 \gset
SELECT id AS open FROM public.props_observations o WHERE NOT EXISTS(SELECT 1 FROM public.props_line_results r WHERE r.observation_id=o.id) ORDER BY id LIMIT 1 \gset
SELECT (ingested_at+interval '1 minute')::text AS before_lock,(lock_at+interval '1 minute')::text AS after_lock,ingested_at::text AS cutoff
 FROM public.props_observations WHERE id=:open \gset

-- 1. Registry: research-only specs only; one row per experiment.
SELECT props_test.at(:'before_lock');
SELECT props_test.raises($$INSERT INTO public.props_lab_experiments(id,spec_sha256,artifact_sha256,spec) VALUES('lab-x-v1',repeat('a',64),repeat('b',64),'{"researchOnly":false}')$$,'check constraint');
INSERT INTO public.props_lab_experiments(id,spec_sha256,artifact_sha256,spec) VALUES('lab-sports-ablation-v1',repeat('a',64),repeat('b',64),'{"researchOnly":true}');
INSERT INTO public.props_lab_events(experiment_id,event,actor) VALUES('lab-sports-ablation-v1','registered','system:lab');

-- 2. A forecast before lock is stored with a database-computed hash.
INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff,inputs)
 VALUES('lab-sports-ablation-v1',repeat('a',64),'combined',:open,0.6,0.38,0.02,:'cutoff','{"books":0.55}');
SELECT props_test.eq((SELECT length(record_sha256)::text FROM public.props_lab_predictions WHERE observation_id=:open),'64','hash stored');
INSERT INTO public.props_lab_flags(experiment_id,observation_id,rules_version,flags,data_cutoff) VALUES('lab-sports-ablation-v1',:open,'lab-risk-flags-v1','{long_absence}',:'cutoff');
SELECT props_test.raises(format($$INSERT INTO public.props_lab_flags(experiment_id,observation_id,rules_version,flags,data_cutoff)
 VALUES('lab-sports-ablation-v1',%s,'lab-risk-flags-v2','{injured}',%L)$$,:open,:'cutoff'),'check constraint');
INSERT INTO public.props_lab_reports(experiment_id,kind,as_of,report) VALUES('lab-sports-ablation-v1','forward_comparison',public.props_now(),'{"n":0}');

-- 3. The same variant can never be written twice (no "improved" second forecast).
SELECT props_test.raises(format($$INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff)
 VALUES('lab-sports-ablation-v1',%L,'combined',%s,0.7,0.28,0.02,%L)$$,repeat('a',64),:open,:'cutoff'),'duplicate key');
-- 4. Wrong spec hash, future data, invalid probabilities are refused.
SELECT props_test.raises(format($$INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff)
 VALUES('lab-sports-ablation-v1',%L,'base',%s,0.6,0.4,0,%L)$$,repeat('f',64),:open,:'cutoff'),'PROPS_LAB_SPEC_MISMATCH');
SELECT props_test.raises(format($$INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff)
 VALUES('lab-sports-ablation-v1',%L,'base',%s,0.6,0.4,0,%L)$$,repeat('a',64),:open,:'after_lock'),'PROPS_LAB_AFTER_LOCK');
SELECT props_test.raises(format($$INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff)
 VALUES('lab-sports-ablation-v1',%L,'base',%s,0.7,0.4,0,%L)$$,repeat('a',64),:open,:'cutoff'),'check constraint');

-- 5. After lock nothing new is accepted, for forecasts or flags.
SELECT props_test.at(:'after_lock');
SELECT props_test.raises(format($$INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff)
 VALUES('lab-sports-ablation-v1',%L,'base',%s,0.6,0.4,0,%L)$$,repeat('a',64),:open,:'cutoff'),'PROPS_LAB_AFTER_LOCK');
SELECT props_test.raises(format($$INSERT INTO public.props_lab_flags(experiment_id,observation_id,rules_version,flags,data_cutoff)
 VALUES('lab-sports-ablation-v1',%s,'lab-risk-flags-v1','{long_absence}',%L)$$,:open,:'cutoff'),'PROPS_LAB_AFTER_LOCK');

-- 6. Once a result exists, no forecast for that line is accepted, even at a (test) clock before lock.
SELECT (o.ingested_at+interval '1 minute')::text AS graded_before_lock,o.ingested_at::text AS graded_cutoff FROM public.props_observations o WHERE id=:graded \gset
SELECT props_test.at(:'graded_before_lock');
SELECT props_test.raises(format($$INSERT INTO public.props_lab_predictions(experiment_id,spec_sha256,variant_id,observation_id,p_more,p_less,p_tie,data_cutoff)
 VALUES('lab-sports-ablation-v1',%L,'base',%s,0.6,0.4,0,%L)$$,repeat('a',64),:graded,:'graded_cutoff'),'PROPS_LAB_RESULT_KNOWN');

-- 7. Append-only for everyone: no update, no delete, even for the table owner; the view shows no tampering.
SELECT props_test.raises($$UPDATE public.props_lab_predictions SET p_more=0.7,p_less=0.28$$,'permission denied');
SELECT props_test.raises($$DELETE FROM public.props_lab_predictions$$,'permission denied');
RESET ROLE;
SELECT props_test.raises($$UPDATE public.props_lab_predictions SET p_more=0.7,p_less=0.28$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_lab_predictions$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$UPDATE public.props_lab_experiments SET spec_sha256=repeat('c',64)$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_lab_flags$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_lab_reports$$,'PROPS_IMMUTABLE');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_lab_prediction_tampering),'0','no tampering');
-- A superuser bypassing the trigger is still caught by the hash check.
ALTER TABLE public.props_lab_predictions DISABLE TRIGGER props_append_only;
UPDATE public.props_lab_predictions SET p_more=0.7,p_less=0.28 WHERE observation_id=:open;
ALTER TABLE public.props_lab_predictions ENABLE TRIGGER props_append_only;
SELECT props_test.eq((SELECT count(*)::text FROM public.props_lab_prediction_tampering),'1','tampering detected');
SET ROLE anon;
SELECT props_test.raises($$SELECT count(*) FROM public.props_lab_predictions$$,'permission denied');
RESET ROLE;
SELECT 'PROPS_LAB_V1_SQL_TESTS_PASS' AS result;
