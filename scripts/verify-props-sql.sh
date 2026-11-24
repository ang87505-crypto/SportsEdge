#!/usr/bin/env bash
# Disposable local PostgreSQL (15+) verification for props_v1 and its additive migrations. Run as root (uses `su postgres`).
# Synthetic TEST data only; no Supabase, provider or ESPN access.
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /var/tmp/props-sql.XXXXXX); chmod 755 "$work"
cp "$repo/database/props/props_v1.sql" "$repo/database/props/props_budget_v2.sql" "$repo/database/props/tests/props_v1_test.sql" "$repo/database/props/tests/props_budget_v2_test.sql" "$repo/database/props/props_market_v1.sql" "$repo/database/props/tests/props_market_v1_test.sql" "$repo/database/props/props_learning_v1.sql" "$repo/database/props/tests/props_learning_v1_test.sql" "$repo/database/props/props_capture_v1.sql" "$repo/database/props/tests/props_capture_v1_test.sql" "$repo/database/props/props_budget_v3_actuals.sql" "$repo/database/props/tests/props_budget_v3_actuals_test.sql" "$repo/database/props/props_lab_v1.sql" "$repo/database/props/tests/props_lab_v1_test.sql" "$repo/database/props/props_penny_paper_v1.sql" "$repo/database/props/tests/props_penny_paper_v1_test.sql" "$repo/database/props/forward_studies_setup.sql" "$repo/database/props/tests/props_setup_privileges_test.sql" "$repo/database/props/checks/forward_studies_readiness.sql" "$work/"; chmod 644 "$work"/*.sql
su postgres -c "psql -qAt -c \"DO \\\$\\\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \\\$\\\$;\""
su postgres -c "psql -qAt -c \"DO \\\$\\\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \\\$\\\$;\""
su postgres -c "psql -qAt -c \"DO \\\$\\\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \\\$\\\$;\""
su postgres -c "dropdb --if-exists props_t; createdb props_t"
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_v1.sql >/dev/null"
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_v1_test.sql" | tail -1
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_budget_v2.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_budget_v2_test.sql" | tail -1
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_market_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_market_v1_test.sql" | tail -1
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_learning_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_learning_v1_test.sql" | tail -1
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_capture_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_capture_v1_test.sql" | tail -1
# PROPOSAL (owner approval before applying in production): provider-reported cost accounting.
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_budget_v3_actuals.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_budget_v3_actuals_test.sql" | tail -1
# AI Learning Lab (research only): immutable forward forecasts, pre-lock flags and reports.
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_lab_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_lab_v1_test.sql" | tail -1
# Separate cent-sized virtual cohort, then prove the owner setup bundle is safe to re-run.
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_penny_paper_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/props_penny_paper_v1_test.sql" | tail -1
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_t -f $work/forward_studies_setup.sql" >/dev/null
# A fresh database verifies first installation through the exact owner bundle, then its no-op repeat.
su postgres -c "dropdb --if-exists props_setup_t; createdb props_setup_t"
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -f $work/props_v1.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role'" >/dev/null

# The owner readiness query must remain read-only and detect unsafe configurations on this disposable database.
check_study_readiness() {
  local expected="$1" label="$2" query_file="forward_studies_readiness.sql" actual
  if [[ $# -eq 3 ]]; then query_file="$3"; fi
  actual=$(su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'BEGIN READ ONLY' -f $work/$query_file -c ROLLBACK" |
    awk -F '|' '$1 == "zz" && $2 == "OVERALL" { print $3 }')
  if [[ "$actual" != "$expected" ]]; then
    printf 'Forward readiness %s: expected %s, received %s\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
  printf 'Forward readiness %s: %s (read-only query)\n' "$label" "$actual"
}
check_study_readiness NOT_READY missing-study-schema
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -f $work/forward_studies_setup.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -f $work/forward_studies_setup.sql" >/dev/null
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -f $work/props_setup_privileges_test.sql" | tail -1
check_study_readiness READY installed-and-repeated
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'GRANT TRUNCATE ON public.props_lab_experiments TO service_role'" >/dev/null
check_study_readiness NOT_READY excess-truncate-grant
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -f $work/forward_studies_setup.sql" >/dev/null
check_study_readiness READY grants-repaired-by-unchanged-bundle
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_lab_experiments DISABLE TRIGGER props_append_only'" >/dev/null
# Reproduce the original check's false READY, then require the repaired check to refuse the same state.
sed "s/ AND t.tgenabled IN ('O','A')//" "$work/forward_studies_readiness.sql" > "$work/forward_studies_legacy_readiness.sql"
chmod 644 "$work/forward_studies_legacy_readiness.sql"
check_study_readiness READY legacy-disabled-trigger-regression forward_studies_legacy_readiness.sql
check_study_readiness NOT_READY disabled-append-only-trigger
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_lab_experiments ENABLE REPLICA TRIGGER props_append_only'" >/dev/null
check_study_readiness NOT_READY replica-only-append-only-trigger
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_lab_experiments ENABLE ALWAYS TRIGGER props_append_only'" >/dev/null
check_study_readiness READY always-enabled-append-only-trigger
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_lab_experiments ENABLE TRIGGER props_append_only'" >/dev/null
check_study_readiness READY origin-enabled-append-only-trigger
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_penny_entries DISABLE TRIGGER props_penny_freeze'" >/dev/null
check_study_readiness NOT_READY disabled-penny-freeze
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_penny_entries ENABLE TRIGGER props_penny_freeze'" >/dev/null
check_study_readiness READY restored-penny-freeze
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_lab_predictions ENABLE REPLICA TRIGGER props_lab_prediction_chronology'" >/dev/null
check_study_readiness NOT_READY replica-only-lab-chronology
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'ALTER TABLE public.props_lab_predictions ENABLE TRIGGER props_lab_prediction_chronology'" >/dev/null
check_study_readiness READY restored-lab-chronology
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'DROP TRIGGER props_append_only ON public.props_lab_experiments; CREATE TRIGGER props_append_only BEFORE UPDATE ON public.props_lab_experiments FOR EACH ROW EXECUTE FUNCTION public.props_immutable()'" >/dev/null
check_study_readiness NOT_READY append-only-missing-delete
su postgres -c "psql -qAt -v ON_ERROR_STOP=1 -d props_setup_t -c 'DROP TRIGGER props_append_only ON public.props_lab_experiments; CREATE TRIGGER props_append_only BEFORE UPDATE OR DELETE ON public.props_lab_experiments FOR EACH ROW EXECUTE FUNCTION public.props_immutable()'" >/dev/null
check_study_readiness READY restored-append-only-events
su postgres -c "dropdb props_setup_t"
cd "$repo" && PROPS_PG_TEST=1 node --experimental-strip-types --no-warnings --test src/lib/server/props-cycle.integration.test.mjs src/lib/server/props-tick.integration.test.mjs src/lib/server/props-monotone-shadow.integration.test.mjs
