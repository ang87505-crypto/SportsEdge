#!/usr/bin/env bash
# Disposable native PostgreSQL verification. Requires Docker, Node 24 and Python.
# Runs committed source in /tmp; preserves the caller's checkout and its changes.
# Broker tests use synthetic accounts. No Alpaca/Supabase credentials are required.
set -Eeuo pipefail

for tool in git docker node python3 tar mktemp timeout; do
  command -v "$tool" >/dev/null || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)' || {
  printf 'Use Node 24, matching the controller workflow.\n' >&2; exit 1;
}
repo=$(git rev-parse --show-toplevel)
target=$(git -C "$repo" rev-parse --verify --end-of-options "${1:-HEAD}^{commit}")
previous=b680bf18a907e77cf5026b6bdd31449bbc913b36
git -C "$repo" cat-file -e "$previous:database/staging/paper_auto_v1.sql" || {
  printf 'The pinned previous schema is missing from local Git history. Fetch it first.\n' >&2; exit 1;
}
timeout --kill-after=5 20 docker info >/dev/null
run_dir=$(mktemp -d /tmp/sportsedge-paper-pg17.XXXXXX)
container_id=
exec > >(tee "$run_dir/verification.log") 2>&1
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [[ -n "$container_id" ]] && ! timeout --kill-after=5 20 docker rm -f -v "$container_id" >/dev/null 2>&1; then
    printf 'Container cleanup failed: %s\n' "$container_id"
    result=1
  fi
  if [[ "$result" == 0 ]]; then
    printf '\nSPORTSEDGE_NATIVE_PG17_PASS\n'
  else
    printf '\nSPORTSEDGE_NATIVE_PG17_FAILED (exit %s)\n' "$result"
  fi
  printf 'Tested commit: %s\nLog: %s/verification.log\n' "$target" "$run_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'printf "Verification stopped at line %s.\n" "$LINENO" >&2' ERR

printf 'Testing committed source: %s\n' "$target"
node --version
python3 --version
mkdir "$run_dir/source" "$run_dir/bin"
git -C "$repo" archive "$target" | tar -x -C "$run_dir/source"
git -C "$repo" show "$previous:database/staging/paper_auto_v1.sql" > "$run_dir/previous.sql"
cd "$run_dir/source"
cp database/staging/paper_auto_v1.sql "$run_dir/fresh.sql"
cat "$run_dir/previous.sql" database/staging/paper_auto_risk_v2.sql \
  database/staging/paper_auto_risk_v2.sql > "$run_dir/upgraded.sql"

printf 'Starting an isolated PostgreSQL 17 container (first run may download the image).\n'
container_id=$(docker run -d --network none --label sportsedge.test=paper-auto-native \
  -e POSTGRES_PASSWORD=sportsedge-disposable-test postgres:17)
export SPORTSEDGE_TEST_PG_CONTAINER="$container_id"
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container_id" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { docker logs "$container_id"; exit 1; }
docker image inspect postgres:17 --format 'PostgreSQL image ID: {{.Id}}'

# psql lives inside the container. Each invocation opens an independent real
# connection; forward PGOPTIONS so each synthetic clock remains pinned.
# -c calls never attach the caller's terminal. SQL scripts still stream stdin.
# No source, keys or host ports are mounted. Client and server timeouts bound
# stalled commands, including schema application before the race-suite timeout.
cat > "$run_dir/bin/psql" <<'PSQL'
#!/usr/bin/env bash
set -euo pipefail
input=(-i)
for arg in "$@"; do
  case "$arg" in -c|--command|--command=*|-c?*) input=(); break ;; esac
done
if [[ "${#input[@]}" == 0 ]]; then exec </dev/null; fi
exec timeout --kill-after=5 45 docker exec "${input[@]}" \
  -e PGHOST=/var/run/postgresql -e PGPORT=5432 -e PGUSER=postgres \
  -e PGDATABASE="${PGDATABASE:-postgres}" \
  -e PGOPTIONS="-c statement_timeout=40000 -c lock_timeout=15000 ${PGOPTIONS:-}" \
  "$SPORTSEDGE_TEST_PG_CONTAINER" psql "$@"
PSQL
chmod 700 "$run_dir/bin/psql"
export PATH="$run_dir/bin:$PATH"
export PGDATABASE=postgres PAPER_AUTO_E2E_PG=1 PAPER_AUTO_REQUIRE_E2E=1
psql -X -At -v ON_ERROR_STOP=1 -c 'SELECT version()'
psql -X -v ON_ERROR_STOP=1 -c \
  'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;'

for mode in fresh upgraded; do
  printf '\nSQL contract: %s schema\n' "$mode"
  database="sportsedge_verify_${mode}"
  psql -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database"
  printf 'Applying %s schema for the SQL contract...\n' "$mode"
  psql -X -q -v ON_ERROR_STOP=1 -d "$database" < "$run_dir/$mode.sql"
  timeout --kill-after=5 180 psql -X -q -v ON_ERROR_STOP=1 -d "$database" < database/tests/paper_auto_v1.sql
  printf '\nIndependent-connection races: %s schema\n' "$mode"
  database="sportsedge_verify_${mode}_race"
  psql -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database"
  printf 'Applying %s schema for the race tests...\n' "$mode"
  psql -X -q -v ON_ERROR_STOP=1 -d "$database" < "$run_dir/$mode.sql"
  printf 'Starting race tests (four-minute deadline).\n'
  PGDATABASE="$database" timeout --kill-after=5 240 bash database/tests/paper_auto_v1_race.sh </dev/null
done

printf '\nPython signal bridge (synthetic captures)\n'
timeout --kill-after=5 180 python3 -m unittest analytics.test_stock_forward_bridge_v1 -v </dev/null
printf '\nNode controller and focused regressions: fresh schema\n'
timeout --kill-after=5 600 node --experimental-strip-types --test --test-reporter=tap \
  src/lib/server/paper-auto-controller.test.mjs \
  src/lib/server/paper-auto-risk.test.mjs \
  src/lib/server/paper-auto-broker.test.mjs \
  src/lib/server/paper-auto-owner.test.mjs \
  src/lib/server/paper-auto-worker.test.mjs \
  src/lib/stocks/paper-auto-performance.test.mjs \
  src/lib/stocks/paper-strategy-rebalance.test.mjs </dev/null

# The controller fixture reads this path. Change only the disposable archive's
# schema input to prove the same controller suite on old v1 + v2 applied twice.
printf '\nNode controller: pinned previous schema plus twice-applied upgrade\n'
cp "$run_dir/upgraded.sql" database/staging/paper_auto_v1.sql
timeout --kill-after=5 600 node --experimental-strip-types --test --test-reporter=tap \
  src/lib/server/paper-auto-controller.test.mjs </dev/null

printf '\nChecking the existing release switches\n'
node <<'JS'
const fs = require('node:fs');
const release = fs.readFileSync('src/lib/stocks/paper-auto-release.ts', 'utf8');
for (const flag of ['brokerWritesEnabled:false', 'scheduledRunsEnabled:true', 'realMoneyEnabled:false']) {
  if (!release.includes(flag)) throw Error('Unexpected release flag: ' + flag);
}
for (const kind of ['decision', 'owner']) {
  const workflow = fs.readFileSync('.github/workflows/paper-auto-' + kind + '.yml', 'utf8');
  if (/^\s*schedule:/m.test(workflow)) throw Error('Unexpected schedule: ' + kind);
  if (kind === 'owner' && !workflow.includes('if: github.actor == github.repository_owner')) {
    throw Error('Missing repository-owner restriction');
  }
}
JS
