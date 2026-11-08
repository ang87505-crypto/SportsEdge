\set ON_ERROR_STOP on
-- props_learning_v1 contract tests (disposable DB; assumes props_v1_test.sql helpers and pinned clock).
SET ROLE service_role;
SELECT props_test.at('2026-11-10T12:00:00Z');

-- 1. Seeded control: layer 1 active, learning and auto-switch on.
SELECT props_test.eq((SELECT active_model_version||'/'||coalesce(previous_model_version,'-')||'/'||learning_enabled||'/'||auto_switch_enabled
 FROM public.props_model_control),'props-nb-minutes-rate-v1/-/true/true','seed control');

-- 2. Learning switches keep the active model.
SELECT public.props_set_learning(false,false,'owner:test','pause learning');
SELECT props_test.eq((SELECT active_model_version||'/'||learning_enabled||'/'||auto_switch_enabled FROM public.props_model_control),
 'props-nb-minutes-rate-v1/false/false','learning off');
SELECT public.props_set_learning(true,true,'owner:test','resume learning');

-- 3. Artifacts and events; bad versions and event names are refused.
INSERT INTO public.props_model_artifacts(version,sha256,artifact) VALUES('props-learn-v1',repeat('c',64),'{"modelVersion":"props-learn-v1"}');
INSERT INTO public.props_model_events(version,event,reason,actor) VALUES('props-learn-v1','created','test','system:test'),
 ('props-learn-v1','shadow_start','test','system:test');
SELECT props_test.raises($$INSERT INTO public.props_model_artifacts(version,sha256,artifact) VALUES('learn-v1',repeat('c',64),'{}')$$,'check constraint');
SELECT props_test.raises($$INSERT INTO public.props_model_events(version,event,reason,actor) VALUES('props-learn-v1','won','x','y')$$,'check constraint');

-- 4. Promotion needs an eligible event; it activates the v2 accounts once.
SELECT props_test.raises($$SELECT public.props_promote_model('props-learn-v1','system:auto-switch','gate')$$,'PROPS_MODEL_NOT_ELIGIBLE');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_account_activations a JOIN public.props_accounts c ON c.id=a.account_id
 WHERE c.selection_version='props-select-v2'),'0','v2 inactive before promotion');
INSERT INTO public.props_model_events(version,event,reason,actor,detail) VALUES('props-learn-v1','eligible','gate passed','system:test','{"lines":512}');
SELECT props_test.eq(public.props_promote_model('props-learn-v1','system:auto-switch','gate passed')->>'active','props-learn-v1','promote');
SELECT props_test.eq((SELECT active_model_version||'/'||previous_model_version FROM public.props_model_control),
 'props-learn-v1/props-nb-minutes-rate-v1','after promote');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_account_activations a JOIN public.props_accounts c ON c.id=a.account_id
 WHERE c.selection_version='props-select-v2'),'2','v2 activated');
SELECT props_test.raises($$SELECT public.props_promote_model('props-learn-v1','owner:test','again')$$,'PROPS_MODEL_ALREADY_ACTIVE');
SELECT props_test.eq((SELECT event FROM public.props_model_events WHERE version='props-learn-v1' ORDER BY id DESC LIMIT 1),'promoted','promoted event');

-- 5. A second promotion does not add activations.
INSERT INTO public.props_model_artifacts(version,sha256,artifact) VALUES('props-learn-v2',repeat('d',64),'{"modelVersion":"props-learn-v2"}');
INSERT INTO public.props_model_events(version,event,reason,actor) VALUES('props-learn-v2','eligible','gate passed','system:test');
SELECT public.props_promote_model('props-learn-v2','owner:test','approve');
SELECT props_test.eq((SELECT count(*)::text FROM public.props_account_activations a JOIN public.props_accounts c ON c.id=a.account_id
 WHERE c.selection_version='props-select-v2'),'2','still two activations');

-- 6. Roll back restores the previous model once; a second roll back is refused.
SELECT props_test.eq(public.props_rollback_model('owner:test','undo')->>'active','props-learn-v1','rollback');
SELECT props_test.eq((SELECT active_model_version||'/'||coalesce(previous_model_version,'-') FROM public.props_model_control),
 'props-learn-v1/-','after rollback');
SELECT props_test.raises($$SELECT public.props_rollback_model('owner:test','again')$$,'PROPS_NO_PREVIOUS_MODEL');
SELECT props_test.eq((SELECT event FROM public.props_model_events WHERE version='props-learn-v2' ORDER BY id DESC LIMIT 1),'rolled_back','rolled back event');

-- 7. Entries into an account without an activation are refused; v1 accounts stay active.
SELECT props_test.eq((SELECT count(*)::text FROM public.props_account_activations a JOIN public.props_accounts c ON c.id=a.account_id
 WHERE c.selection_version='props-select-v1' AND a.active_from<=public.props_now()),'2','v1 active');
RESET ROLE;
INSERT INTO public.props_accounts(slug,platform,selection_version,initial_cents,stake_cents,max_entries_per_day,picks_per_entry)
 VALUES('props-test-inactive-v9','prizepicks','props-select-v2',50000,500,3,2);
SET ROLE service_role;
SELECT props_test.eq(public.props_begin_run('collect','collect-learning-v1','gha:l1',NULL,600)->>'outcome','STARTED','learning run');
SELECT props_test.raises(format($$SELECT public.props_record_entry(%s,%s,'{1,2}','power',NULL)$$,
 (SELECT id FROM public.props_accounts WHERE slug='props-test-inactive-v9'),(SELECT id FROM public.props_runs WHERE slot_key='collect-learning-v1')),
 'PROPS_ACCOUNT_INACTIVE');

-- 8. Append-only for everyone; no access for anon.
INSERT INTO public.props_learning_reports(period_from,period_to,model_version,report) VALUES('2026-11-03','2026-11-09','props-learn-v1','{"misses":{}}');
SELECT props_test.raises($$UPDATE public.props_model_control_log SET learning_enabled=false$$,'permission denied');
RESET ROLE;
SELECT props_test.raises($$UPDATE public.props_model_control_log SET learning_enabled=false$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_model_events$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$UPDATE public.props_model_artifacts SET sha256=repeat('e',64)$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_account_activations$$,'PROPS_IMMUTABLE');
SELECT props_test.raises($$DELETE FROM public.props_learning_reports$$,'PROPS_IMMUTABLE');
SET ROLE anon;
SELECT props_test.raises($$SELECT count(*) FROM public.props_model_control$$,'permission denied');
SELECT props_test.raises($$SELECT public.props_promote_model('props-learn-v1','anon','x')$$,'permission denied');
RESET ROLE;
SELECT 'PROPS_LEARNING_V1_SQL_TESTS_PASS' AS result;
