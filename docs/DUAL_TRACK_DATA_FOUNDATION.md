# SportsEdge — Dual-track secure odds collector (Milestone 1)

> **Status update (2026-10-08):** Milestone 1 below is preserved as an historical implementation record. Since then, the `odds_snapshot_dedupe_v1` database constraint was applied, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` were configured in Production, and the collector was updated to atomic conflict-ignore writes. See [Atomic Odds Writes](./ATOMIC_ODDS_WRITES.md) for current status. The ingestion token and live integration test remain outstanding.

## Inspection (October 8, 2026)

Existing project: Next.js 16 / TypeScript; existing Supabase tables `sports`, `leagues`, `teams`, `games`, `odds_snapshots`, `model_predictions`, `paper_bets`. Only `sports` has 9 rows. All tables use RLS, with no public policies. No DB schema changes are made in this milestone. Vercel Production has `ODDS_API_KEY` but does not have backend Supabase credentials or collector authorization token.

## Scope — first data-collection milestone

Created (no existing app files replaced):
- `src/lib/ingestion/normalize.ts`: **pure, tested NBA and EPL adapters**.
- `src/lib/ingestion/normalize.test.mjs`: deterministic synthetic provider contract tests.
- `src/lib/server/collect/odds-collector.ts`: server-only, credential-guarded fetch + Supabase REST persistence.
- `src/app/api/internal/collect-markets/route.ts`: fail-closed bearer-token HTTP endpoint, unavailable without a long private token.
- `.github/workflows/dual-track-verify.yml`: Node 24 tests, lint, typecheck, production build.
- `docs/MODELING_TRACKS.md`: separate NBA and soccer modeling plans.

Initial provider tracks:
| Track | Provider sport key | Supabase sport code | Competition |
| --- | --- | --- | --- |
| NBA | `basketball_nba` | `nba` | National Basketball Association |
| Soccer | `soccer_epl` | `soccer` | English Premier League |

No assumption that EPL covers all world soccer, or that NBA preseason market data constitutes regular-season model validation. The current public odds page has an independent MLS soccer mapping; this milestone does NOT overwrite or silently change it.

### Data integrity rules

1. Live or already-started games are skipped; never pretend in-play odds are pregame snapshots.
2. `observed_at` uses **market-level** `last_update`, not the deprecated bookmaker timestamp; `ingested_at` independently records DB receipt.
3. Only complete two-way NBA and three-way EPL moneyline markets are accepted; missing draws, malformed odds, unsupported competitions and invalid timestamps are excluded and counted.
4. Sportsbook identity uses provider bookmaker `key`, not mutable branding.
5. Provider-scoped event IDs upsert league/team data and **insert** games without overwriting already settled game scores.
6. Existing snapshots are read before insert to prevent ordinary repeat-run duplication; API reads are paginated and fail closed if incomplete.
7. No client-side API keys, public write endpoint, public RLS policy, or third-party paid dependency.

**Limitation:** Database-level uniqueness for `odds_snapshots` is not yet enforced, so truly concurrent invocations can race and duplicate snapshots. A separate **additive unique-index migration** and a single-flight lock are required before enabling unattended recurring collection. Also, the Odds API call is **not scheduled** in this milestone. The collector cannot be called without the secret token, and no production rows are expected until all credentials are configured and an authorized integration run succeeds.

### Free-tier quota

The collector requests two Odds API calls for `h2h` only, `regions=us`: ~1 quota credit per league when data is returned; total of ~2 credits per manually authorized full run, subject to provider policy. It does not poll automatically. Source: https://the-odds-api.com/liveapi/guides/v4/ . For scheduling later, Vercel Hobby cron jobs are limited to once per day: https://vercel.com/docs/cron-jobs/usage-and-pricing .

### Owner-only setup, not done automatically

In Vercel project Settings > Environment Variables, Production add:
- `SUPABASE_URL`: Supabase Project URL (HTTPS, `.supabase.co`).
- `SUPABASE_SECRET_KEY`: server-only **new secret key** `sb_secret_...`, recommended; or legacy `SUPABASE_SERVICE_ROLE_KEY` if necessary. Never prefix secrets with `NEXT_PUBLIC_`.
- `SPORTSEDGE_INGEST_TOKEN`: a random 32+ character token; requests must send `Authorization: Bearer <TOKEN>`.

Do **not** paste secret values into GitHub, ChatGPT, screenshots, or client code. Use the dashboard secret input. Privileged service keys bypass RLS, so never place them in a browser. Rebuild/redeploy after config. New sb_secret_ keys are sent in `apikey` header only; legacy service role JWT additionally uses bearer Authorization.

Authorized run (after security prerequisite/index and credentials are configured): invoke `GET /api/internal/collect-markets` from an authenticated server or secure terminal, with that bearer header. Anonymous callers receive HTTP 404; missing DB config yields 503 after successful auth. The endpoint returns only counts, not raw provider prices or keys. **Do not schedule it until DB-level deduplication and production smoke test are verified.**

### Verification checklist

```sh
node --test src/lib/ingestion/normalize.test.mjs
npm run lint
npx tsc --noEmit
npm run build
```

GitHub Actions independently runs these checks. Verify Vercel preview deployment is READY. No live ingestion, final-score reconciliation, model training, or profit metrics are claimed at this stage.

### Next independently testable milestone

With owner approval, add a unique/idempotency database constraint and single-flight lock without dropping/recreating existing tables. Test against duplicates. Configure the backend secrets privately, execute one authorized production capture, and verify real persisted NBA and EPL rows from Supabase. Only then consider a once-daily Hobby cron for snapshots. After that, add game result reconciliation from a licensed source and separately evaluate NBA and soccer prediction models.
