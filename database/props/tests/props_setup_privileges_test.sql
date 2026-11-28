\set ON_ERROR_STOP on
-- Applied after installation with broad legacy Supabase defaults deliberately enabled.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['props_lab_experiments','props_lab_events','props_lab_predictions','props_lab_flags','props_lab_reports','props_lab_stakes',
  'props_penny_cohorts','props_penny_entries','props_penny_settlements'] LOOP
  IF has_table_privilege('anon','public.'||t,'SELECT') OR has_table_privilege('authenticated','public.'||t,'SELECT')
   OR has_table_privilege('service_role','public.'||t,'UPDATE') OR has_table_privilege('service_role','public.'||t,'DELETE')
   OR has_table_privilege('service_role','public.'||t,'TRUNCATE') THEN RAISE EXCEPTION 'STUDY_EXCESS_PRIVILEGE: %',t; END IF;
  IF NOT has_table_privilege('service_role','public.'||t,'SELECT') OR NOT has_table_privilege('service_role','public.'||t,'INSERT') THEN
   RAISE EXCEPTION 'STUDY_REQUIRED_PRIVILEGE: %',t; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'STUDY_RLS_MISSING: %',t; END IF;
 END LOOP;
END $$;
SELECT 'FORWARD_STUDY_PRIVILEGES_PASS';
