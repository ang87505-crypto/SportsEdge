-- READ-ONLY readiness check for the forward studies (cross-review 2026-11-21). NOT a migration; changes nothing.
-- Run in the Supabase SQL editor of the ACTIVE props project vfyzbliksooljxrlfadp, before and after applying the
-- unchanged #200 bundle database/props/forward_studies_setup.sql (pinned at 42fe0bcaec5d06f049f0943914a8cd99cca4aad4).
-- Release requires the OVERALL row = READY. Anything else: stop and review; never edit grants or rows by hand.
--
-- Stricter than the existence query in docs/PAPER_TESTING_INTEGRATION_2026_11_20.md (step 2) and the app's GET-only
-- forwardStudyReadiness(): those cannot see excess privileges. Supabase's default grants give service_role
-- UPDATE/DELETE/TRUNCATE on new public tables; main's props_lab_v1.sql did not revoke them, and TRUNCATE bypasses the
-- append-only row triggers. The #200 bundle's final grant block narrows all nine tables to SELECT,INSERT.
-- Candidate follow-up: disabled and replica-only triggers do not protect normal writer sessions.
-- The trigger must fire in origin/local mode (O) or always (A). This is a configuration check, not proof of a completed worker run.
-- MISSING means "not present in this database", never inferred from an inaccessible project.
WITH want(rel, kind, grp) AS (VALUES
  ('props_lab_experiments','r','lab'),('props_lab_events','r','lab'),('props_lab_predictions','r','lab'),
  ('props_lab_flags','r','lab'),('props_lab_reports','r','lab'),('props_lab_stakes','r','lab'),
  ('props_penny_cohorts','r','penny'),('props_penny_entries','r','penny'),('props_penny_settlements','r','penny'),
  ('props_penny_tampering','v','penny')),
c AS (
  SELECT w.*, k.oid, k.relkind::text AS actual_kind, k.relrowsecurity AS rls
  FROM want w LEFT JOIN pg_class k ON k.relname = w.rel AND k.relnamespace = 'public'::regnamespace),
chk AS (
  SELECT grp, rel, kind, actual_kind,
    oid IS NOT NULL AS present,
    CASE WHEN oid IS NULL THEN NULL ELSE has_table_privilege('service_role', oid, 'SELECT') END AS svc_select,
    CASE WHEN oid IS NULL THEN NULL ELSE has_table_privilege('service_role', oid, 'INSERT') END AS svc_insert,
    CASE WHEN oid IS NULL THEN NULL ELSE (has_table_privilege('service_role', oid, 'UPDATE') OR has_table_privilege('service_role', oid, 'DELETE')
       OR has_table_privilege('service_role', oid, 'TRUNCATE')) END AS svc_mutate,
    CASE WHEN oid IS NULL THEN NULL ELSE (has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) END AS public_access,
    rls,
    EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'props_append_only' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) AS append_only_trigger
  FROM c),
v AS (
  SELECT *, CASE
    WHEN NOT present THEN 'MISSING'
    WHEN actual_kind <> kind THEN 'WRONG_KIND'
    WHEN public_access THEN 'ANON_OR_AUTHENTICATED_ACCESS'
    WHEN NOT svc_select THEN 'SERVICE_ROLE_CANNOT_READ'
    WHEN kind = 'r' AND NOT svc_insert THEN 'SERVICE_ROLE_CANNOT_INSERT'
    WHEN kind = 'v' AND svc_insert THEN 'SERVICE_ROLE_CAN_INSERT_VIEW'
    WHEN svc_mutate THEN 'SERVICE_ROLE_CAN_UPDATE_DELETE_OR_TRUNCATE'
    WHEN kind = 'r' AND NOT rls THEN 'RLS_DISABLED'
    WHEN kind = 'r' AND NOT append_only_trigger THEN 'APPEND_ONLY_TRIGGER_MISSING'
    ELSE 'READY' END AS state
  FROM chk),
seq AS (
  SELECT CASE WHEN to_regclass('public.props_penny_entries_id_seq') IS NULL OR to_regclass('public.props_penny_settlements_id_seq') IS NULL
    THEN 'MISSING' WHEN has_sequence_privilege('service_role','public.props_penny_entries_id_seq','USAGE')
    AND has_sequence_privilege('service_role','public.props_penny_settlements_id_seq','USAGE') THEN 'READY' ELSE 'SERVICE_ROLE_NO_USAGE' END AS state)
SELECT grp, rel, state, present, svc_select, svc_insert, svc_mutate, public_access, rls, append_only_trigger FROM v
UNION ALL
SELECT 'penny', 'penny id sequences', state, NULL, NULL, NULL, NULL, NULL, NULL, NULL FROM seq
UNION ALL
SELECT 'zz', 'OVERALL', CASE WHEN (SELECT bool_and(state = 'READY') FROM v) AND (SELECT state FROM seq) = 'READY'
  THEN 'READY' ELSE 'NOT_READY' END, NULL, NULL, NULL, NULL, NULL, NULL, NULL
ORDER BY 1, 2;
