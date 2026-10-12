# SportsEdge UX, paper metrics and connection clarity — October 12, 2026

Status: isolated review branch stacked on PR #26. No merges or runtime activation.

## Implemented
- Make simulation/research status visible in the top bar; add paper-performance shortcut from desktop sidebar.
- Improve mobile nav tap areas and small-screen layout; improve responsive stats, scrollable tabs and data tables.
- Add paper account primer with direct model research and platform-guide links.
- Make pending reserved stake, settled results and realized P/L easier to distinguish. All numbers come from existing server-side paperPerformance(); no fabricated values.
- Add a home-page data source/status overview based only on the existing /api/research request and static, truthful stock limitations.

## Explicitly unchanged
- No changes to prediction algorithms, stock execution/accounting or research fixtures.
- No database schema writes, Supabase changes, credentials, brokerage connectivity or provider calls.
- No paper-run API, control flag, sportsbook requests, wager placement or stock trade execution changes.
- No claim of profitable model performance or live account balances.

## Required verification before merge/deploy
1. Run npm install/npm ci as applicable, npm run lint, npx tsc --noEmit, npm run build, and existing Node/Python tests on exact branch commit.
2. Browser check routes /, /sports, /stocks, /paper-betting, /research/nba, /guide at widths 320, 390, 768, 1024, 1440; verify keyboard focus and back/home links.
3. Test API outage on home: show ledger unavailable, never zeroed balances. On paper page ledger outage continues to show unavailable.
4. Confirm pending stake is not represented as a loss, ROI isn't the same as historical model accuracy, and no real-money balance is implied.
5. Combined branch integration remains outstanding: #11 overlaps stocks UI; base branch #26 depends on unmerged PRs #16, #18–#25. Do not merge this branch directly into main without approved dependency integration.
6. Check authenticated staging, database migration #22 and duplicate command receipts separately. Keep SPORTSEDGE_PAPER_RUNS_ENABLED=false/unset.
7. Verify Vercel preview and GitHub CI; no live-browser checks were performed by this PR.

## Remaining work by phase
- Phase 1: full cross-device visual QA and navigation refinements against rendered browser screens; this patch is a focused code improvement, not a full redesign.
- Phase 2: unified stock paper-portfolio data requires completion of the distinct transactionally safe engine; no fake total or derived realized return should be surfaced.
- Phase 3: actual Supabase and Alpaca connection-health endpoints require security and permissions review, integration staging and authorized accounts. Current UI reports only observed existing ledger status and honest known capability limits.
