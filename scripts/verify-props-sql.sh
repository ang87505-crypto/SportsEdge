#!/usr/bin/env bash
# Disposable local PostgreSQL (15+) verification for props_v1 and its additive migrations. Run as root (uses `su postgres`).
# Synthetic TEST data only; no Supabase, provider or ESPN access.
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d /var/tmp/props-sql.XXXXXX); chmod 755 "$work"
cp "$repo/database/props/props_v1.sql" "$repo/database/props/props_budget_v2.sql" "$repo/database/props/tests/props_v1_test.sql" "$repo/database/props/tests/props_budget_v2_test.sql" "$repo/database/props/props_market_v1.sql" "$repo/database/props/tests/props_market_v1_test.sql" "$repo/database/props/props_learning_v1.sql" "$repo/database/props/tests/props_learning_v1_test.sql" "$repo/database/props/props_capture_v1.sql" "$repo/database/props/tests/props_capture_v1_test.sql" "$repo/database/props/props_budget_v3_actuals.sql" "$repo/database/props/tests/props_budget_v3_actuals_test.sql" "$repo/database/props/props_lab_v1.sql" "$repo/database/props/tests/props_lab_v1_test.sql" "$work/"; chmod 644 "$work"/*.sql
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
cd "$repo" && PROPS_PG_TEST=1 node --experimental-strip-types --no-warnings --test src/lib/server/props-cycle.integration.test.mjs src/lib/server/props-tick.integration.test.mjs
