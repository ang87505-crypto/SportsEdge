# Isolated research fixture Preview — 2026-10-18

## Scope and provenance

This is an **owner-approved, synthetic-only Preview** for PR #81
(`claude/bold-newton-4j0x26`). The existing **SportsEdge Staging**
Supabase project (`mcaxfaaohyencpspalfe`) was already provisioned.
Production Supabase was not changed, copied, or queried for fixtures.
The separate existing Alpaca staging/PAPER migration schema was not touched.

We applied staging migration `preview_research_synthetic_readonly_v1`
to create exactly eight minimal public research/odds/ledger tables:
`leagues`, `teams`, `games`, `odds_snapshots`,
`research_accounts`, `research_forecasts`, `research_positions`,
and `research_settlements`. These have RLS enabled and a **SELECT-only
anon policy**. Neither anon nor authenticated was granted INSERT, UPDATE
or DELETE. Stage rows use synthetic Preview-named teams, test provider
and sportsbook tags only. Current fixture counts: 4 games, 9 test prices,
3 virtual bets (two artificial settlements), 3 forecasts, 1 virtual account.
Fixture values are **not** real sports quotes, validated model forecasts,
owner production bets, strategy backtesting, or investment returns.

The database has no real research data copied from production. Its
publishable key is intended only to read synthetic public fixtures.
No production or staging service-role key was copied into the PR #81 Preview.

## Vercel configuration (values omitted intentionally)

Three Vercel variables are scoped to Preview for only the branch
`claude/bold-newton-4j0x26`:

- `SUPABASE_URL`: the existing isolated SportsEdge Staging URL.
- `SUPABASE_READONLY_KEY`: **sensitive** staging publishable key.
- `SPORTSEDGE_PREVIEW_FIXTURES=1`: opt-in for prominent test-data
  labeling and fail-closed source/key validation.

Production `SUPABASE_URL` and `SUPABASE_SECRET_KEY` remain
production-only and unchanged. The server-side database helper requires
`sb_publishable_` and the exact staging project hostname whenever
the fixture flag is enabled. It will refuse production/database-role keys
when that flag is present.

`WorkspaceShell` shows **STAGING PREVIEW · TEST DATA ONLY** across all
routes if the fixture flag is on. No code uses these records to place
paper orders, schedule broker operations, or admit historical research.

## Verification

- Supabase Staging migration applied successfully.
- An explicit `SET LOCAL ROLE anon` test could read synthetic table
  counts. No write grants were installed for anon/authenticated.
- Vercel Preview variables listed with the requested branch scope,
  without decrypting or displaying key material.
- New Preview deployment at SHA `6f6cf68983a7ab4180ee80b2acabc1fcf2b69c7c`
  returns Vercel deployment `READY`.
- **Still pending owner review:** protected Vercel Preview endpoint
  responses for `/api/research` and `/api/sports?sport=nba`,
  and paper-betting page. The connected Vercel deployment access bypass
  and runtime logs are restricted (403). Do not claim that READY proves
  end-to-end API operation.
- GitHub Actions CI status for PR #81 must be resolved before merge.

This fixture environment has no bearing on quantitative backtest evidence.
Do not remove synthetic labels, merge with production data, or enable
broker writes as part of this Preview work.
