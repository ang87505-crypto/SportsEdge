# Kalshi paper platform — November 20, 2026

This milestone implements the private paper workspace, durable worker, independent research grading and a separate Kalshi demo adapter. It builds on the merged offline ledger in PR #193 and Claude’s independent weather model in PR #194. It does not establish predictive advantage or enable production trading.

## What runs without an account

- The NOAA-only GitHub collector saves immutable NWS forecasts and preliminary Central Park climate reports on `research-data`. Before freezing a new forecast, it checks for an available prior outcome so history can advance sooner. Source failure remains explicit; no historical forecast is fabricated.
- The Vercel worker imports a commit-pinned copy of that archive into private Supabase tables, verifies record hashes/times, freezes one v1 contract forecast per model/date using the actual database receipt time, then grades eligible saved forecasts as outcomes arrive.
- The daily Vercel cron is `35 3 * * *` UTC: nominally 8:35 PM MST in November, after the 01:11/03:11 UTC forecast captures and before the target station’s climate day begins at 05:00 UTC. This leaves 85 minutes for the documented Hobby scheduling imprecision and worker execution. A delayed source or scheduler can still cause a visible missed forecast; the worker never backfills a late record as forward evidence. Timing reference: <https://vercel.com/docs/cron-jobs/usage-and-pricing>.
- The owner dashboard is `/prediction-markets/kalshi`, also linked as **Kalshi paper** in platform navigation. Existing Owner sign-in protects account data and controls. **Update research and paper status** runs the worker; **Run offline system check** stores a clearly synthetic bookkeeping example separately.
- Research grades use preliminary NWS observations, never an exchange settlement or monetary return. The PMF still requires 30 verified training days, including 30 matched forecast horizons. Until then, probabilities are null. A trained PMF remains experimental and uncalibrated.

## Persistence and worker contracts

`database/kalshi/kalshi_paper_platform_v1.sql` was generated with Supabase CLI 3.2.0 and kept in the existing database tree. It was tested locally before being applied to the authorized general app project `fzyjazhvkstvwwzjhlrr`. All ten new tables have RLS; anonymous and authenticated browser roles have no table or worker-RPC access. Existing sports and stock tables are untouched.

The app reuses the production server’s `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `CRON_SECRET`. The store pins the known general app host, uses explicit table/RPC allowlists and bounded responses, and never retries an uncertain write. No new research key or paid provider is required. Optional `KALSHI_SUPABASE_URL` / `KALSHI_SUPABASE_SECRET_KEY` overrides must point to that same project.

Immutable tables retain evidence, contract forecasts, research grades, fixture revisions, demo intents, receipts and account snapshots. Original record JSON is retained as text to preserve pre-existing order-sensitive hashes. Job leases and fixture revision checks serialize duplicate work. Cache imports are bounded and partial catch-up cannot produce a selected-subset model. Database clocks reject late forward forecasts and stale lease completions. Exact row counts detect a hosted PostgREST cap rather than accepting a silently truncated history.

## Demo execution contract

The connector accepts only `https://external-api.demo.kalshi.co`; there is no production-host switch. It supports current Ed25519 and RSA-PSS signing. V2 requests use `POST /trade-api/v2/portfolio/events/orders`, YES-book bid/ask mapping, fixed-point prices/counts, one-contract immediate-or-cancel orders, self-trade prevention and cancel-on-pause. Actual fees from order reads stay distinct from conservative research estimates.

Every possible POST has a durable unique intent and saved decision/market/book/rules snapshot first. A lost response is unknown, disarms automation and is never blindly resubmitted. Partial fills and zero fills remain distinct from acknowledgements. The database limits attempts to three per station climate day and blocks unresolved attempts. Fresh account checks renew health without re-arming a stopped account. Balance reads are spaced within a client to respect the documented endpoint limit.

Start verifies the demo account, working orders, existing holdings and prior unresolved intents. Stop disarms first and attempts to cancel only this system’s working orders. Reconciliation continues for earlier attempts while stopped, while the model is waiting for history, and after a weather-source failure. Official demo settlements are matched to saved market rules and appended separately from NWS grades; corrections during the configured three-day review window preserve earlier receipts. Broker-reported cash/portfolio value are never inferred from synthetic data.

A **Run one demo order test** action can test a connection before the 30-day minimum. It buys one YES demo contract at the available ask, at most $0.99 plus fees, and records `SMOKE`; it is excluded from model evidence. Normal `MODEL` orders require a reproduced frozen training digest, a complete verified strike partition, fresh valid books, available size and at least $0.03 estimated edge after conservative fees and one cent of slippage.

## First real research run

The shared worker completed against the authorized hosted database using a Supabase-connector verification transport, with a repository-pinned source fetch. It stored the November 21 forecast at `2026-11-20T22:00:42.142453Z` (3:00 PM MST November 20), archive ref `e789e4852d838bf6d15ff55fe49724e122b1c757`. Its two training pairs were both horizon matched; the forecast correctly remained `AWAITING_VERIFIED_HISTORY`, with null probabilities, no research grades yet and zero demo attempts. Demo control remained `STOPPED`. Earlier verification attempts retained their failure receipts, including a bounded partial archive catch-up.

This verifies actual source import, model construction, forward persistence and the private read model. It is distinct from invoking the deployed HTTP cron: the browser’s manual Vercel scheduler requires its own sign-in, and the first scheduled HTTP run must be checked separately. Owner account setup is not required for independent research.

## Connected test: owner setup when ready

1. Create/sign into the separate demo account at <https://demo.kalshi.co/> and obtain demo funds at <https://demo.kalshi.co/mockfunds>.
2. Complete the project’s demo/data-access review. Configure production server variables `KALSHI_DEMO_KEY_ID`, `KALSHI_DEMO_PRIVATE_KEY`, `KALSHI_DEMO_ACCESS_APPROVED=1`, and `KALSHI_DEMO_PERMISSION_REFERENCE` containing the reviewed access identifier. A flag is not itself permission. Never paste private keys into chat, code, public build variables or the dashboard.
3. Redeploy with those variables. Sign into SportsEdge as owner, open **Demo account and automation controls**, and select **Check demo account**. Confirm its actual cash and read time.
4. Select **Start demo automation**. Once a future forecast is stored, run the one-contract system test. Refresh/reconcile and inspect its acknowledgement, actual filled count and fees. Exercise Stop and verify it remains stopped. No connected test is claimed until real exchange receipts are stored.
5. Start again when ready for scheduled paper operation. Model orders remain blocked until the history and input requirements are met; an absence of qualifying edge is a valid no-order outcome.

Engineering can be completed before these account steps. At the last independent archive evaluation on November 20 there were only two qualifying training pairs. That evidence cannot establish calibration, accuracy or profitability. Demo prices/fills also do not establish production execution quality.

## Verification and maintenance

Local verification completed before publication:

- Native PostgreSQL 18.7: private grants/RLS, immutable records, leases, real forward clocks, fixture revision/prefix preservation, demo Stop/health renewal, duplicate/concurrent intents, receipt digests and daily limits. Business checks run as `service_role`. The dedicated CI workflow repeats this on PostgreSQL 17, matching hosted major version.
- Kalshi/model/server/navigation/collector/evaluation suite: 155 tests passed after adding hosted row-cap detection. Final full JavaScript run: 1,042 passed, 47 skipped, zero failed. Exact CI checks are recorded on the PR.
- TypeScript and production build passed. ESLint has no errors; six existing warnings remain. Owner sign-in HTTP smoke covers real Kalshi read/write/scheduler authentication boundaries, and the existing assistant HTTP smoke passes.
- Local Chromium launch is blocked by executor Unix-socket restrictions. The GitHub browser workflow passed all 56 route/viewport combinations, including the Kalshi mobile/desktop route, plus a separate client-only owner fixture at 320/390/1440 with blocked order controls, a partial-fill table and offline action. All 14 runnable PR-head checks passed; the live-only monitor job was intentionally skipped. PostgreSQL 17 CI also passed.
- Hosted read-only verification confirms schema version `kalshi-paper-platform-v1`, ten RLS-enabled private tables, service-only check RPC and demo state `STOPPED`. Deployment, actual scheduler invocation and exchange connection must each be checked separately; synthetic tests are not evidence of a live run.

Useful commands:

```sh
node --experimental-strip-types --test src/lib/prediction-markets/kalshi/*.test.mjs src/lib/server/kalshi-*.test.mjs scripts/kalshi-independent-weather-collect.test.mjs scripts/kalshi-weather-contract-eval.test.mjs
npm run lint
npm run build
node scripts/owner-sign-in-smoke.mjs
node scripts/assistant-http-smoke.mjs
KALSHI_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres python scripts/verify-kalshi-platform-sql.py
```

The SQL verifier requires `psycopg[binary]==3.3.9`, accepts localhost only, creates its own unique test database and drops only that database. It must never target hosted data. For browser QA, start an uncredentialed production server on port 3100, then run `node scripts/browser-smoke.mjs` with an available `CHROME_BIN`. Its owner fixture never authenticates to a broker or writes a database.

Official sources checked November 20: <https://docs.kalshi.com/llms.txt>, the current create/cancel V2 order and account schemas, <https://docs.kalshi.com/getting_started/api_keys>, <https://docs.kalshi.com/getting_started/fee_rounding.md>, and current Supabase functions/RLS guidance.
