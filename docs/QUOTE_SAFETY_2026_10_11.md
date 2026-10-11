# Changing-line safeguards — prepared, not released

Base: PR #21, `8ee62e3d2e74709bc0f1cefc9fa4b0a06b8c26ae`.
Owner approved code changes and migration preparation on October 11, 2026.
No production schema changes, provider-credit requests, execution activation, merge, or deployment are authorized by this milestone.

## Problem and behavior

The old runner ranked all complete observations from the last hour by EV. It could select a superseded favorable quote. The old placement RPC did not check for a newer observation.

The runner now selects only the latest observed market for each bookmaker/provider. An incomplete or ambiguous latest market blocks that bookmaker: there is no fallback to its historical prices. Both outcomes must have valid odds and source/ingestion timestamps. Invalid model probabilities and a full 200-row scan fail closed. NBA model version, 2% model-estimated EV threshold, positive no-vig edge, and 1%-of-available-cash stakes are unchanged.

`SPORTSEDGE_QUOTE_MAX_AGE_SECONDS` defaults to 60; integer values 1–60 are accepted. Invalid configuration fails closed. Fresh means the first half of that interval; aging means the second half; both remain subject to final database checks. Stored sports responses now preserve provider identity and ingestion time, report freshness and completeness, and avoid combining provider markets. The existing page has not yet been changed to render the new fields. This is a backend safety milestone, not the completed dashboard.

The prepared migration creates `research_place_current(account, forecast, quote, max_age_seconds)`. It rechecks source age, game status/start, publication chronology, complete market, supersession, EV, cash and the final recording time. The old `research_place` signature delegates to the new function with the 60-second ceiling. Both entry points remain service-role-only and SECURITY INVOKER. Existing positions and history are unchanged. The runner requires the new RPC, so a missing migration fails without falling back to the old unsafe function.

For this low-volume owner-commanded ledger, short SHARE locks on odds_snapshots and games prevent concurrent quote insertions/changes and fixture updates during the placement transaction. The account row remains locked. The lock wait is capped at two seconds. These are broad table locks, not a high-throughput design: verify contention and lock ordering against the real collector in staging before release. There are no external network calls within the transaction.

## Exact changed files

Existing: `src/lib/server/research-operations.ts`, `src/lib/server/research-db.ts`, `src/lib/stocks/paper-runner.test.mjs`.
New: `src/lib/ingestion/current-market.ts`, its `.test.mjs`, `database/migrations/20261011193330_quote_current_market_guard.sql`, `scripts/test-current-market-db.mjs`, this document.
The migration filename was generated with `supabase migration new`, then moved to the established database/migrations directory. It has NOT been applied remotely.

## Verification

- 65 Node tests passed, including current-market, existing authentication, and runner tests.
- 127 Python tests passed; no model changes.
- Lint, production Next.js build and TypeScript passed.
- 16 disposable PostgreSQL/PGlite checks passed, including stale/future quotes, superseded full/incomplete markets, identical-timestamp conflicts, provider mismatch, disappeared EV, cancelled/rescheduled fixtures, insufficient cash, exact cents, replay idempotency, strict configured age, old-entry-point rejection, and RPC grants.
- Two real TypeScript runner → disposable SQL integrations passed: exact quote persisted; a new price inserted after selection caused placement rejection.
- Local production HTTP: /sports, /paper-betting and GET /api/paper-control returned 200; unauthorized POST returned 403. No authenticated browser or live database execution is claimed.
- One initial new Node test failed because its supposedly unprofitable market still offered positive away-side EV. Corrected the synthetic price; full suite then passed.
- First local server start failed on environment network-interface enumeration; explicit localhost binding and same-process HTTP verification succeeded.

Reproduce existing tests:

```sh
npm ci
node --test src/lib/ingestion/*.test.mjs src/lib/research-math.test.mjs src/lib/result-validation.test.mjs src/lib/stocks/*.test.mjs
python -m unittest discover -s analytics -p 'test_*.py'
npm run lint
npm run build
npx tsc --noEmit
```

Disposable database test (PGlite 0.5.8 installed outside the app; no package/lockfile changes):

```sh
npm install --prefix /tmp/sportsedge-db-test --no-audit --no-fund @electric-sql/pglite@0.5.8
SPORTSEDGE_PGLITE_MODULE=/tmp/sportsedge-db-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-current-market-db.mjs
```

PGlite uses a single connection: true multi-session locking, concurrent collector/runner requests, live PostgREST grants, RLS and production load are NOT verified. The test bootstraps only the schema needed for this milestone; it is not a production schema clone.

## Remaining acceptance gates

- Durable per-command receipts and exact placed/skipped/failed run counts are still absent; existing position IDs are not claimed as newly created positions.
- Market disappearance without a new stored observation cannot be detected here. A 60-second source timestamp is not proof a sportsbook would accept a bet. Authorized provider refresh and explicit unavailable/closed-market capture remain required.
- No provider credits were used. Provider latency, update cadence, quota and budget must be reconciled before refresh is enabled. A stricter age limit can produce zero qualifying bets.
- No new NBA 100 × $10 account, EPL execution, settlement pagination, scheduler, fixture reconciliation or model promotion is included.
- Vercel project/team details returned 403 in the preceding audit. Hosting plan, production configuration and preview authentication remain unverified.
- Preserve SPORTSEDGE_PAPER_RUNS_ENABLED unset/false. Review and approve staging migration and deployment, test live privileges and concurrency, then separately decide activation. Do not call the sports side complete.

## References reviewed

- PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- Odds API response and quota semantics: https://the-odds-api.com/liveapi/guides/v4/
- Installed Next.js 16.4 fetch documentation: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md
- Supabase skill security checklist: service-role separation, invoker privileges and RLS. Changelog markdown retrieval was unavailable through web retrieval; no new Supabase client API was introduced.
