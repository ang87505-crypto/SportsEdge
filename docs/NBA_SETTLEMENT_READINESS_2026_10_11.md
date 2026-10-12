# SportsEdge NBA paper-result reconciliation — milestone (2026-10-11)

**Context:** Stacked on draft PR #23 (which inherits #22 changing-line safety and #21 owner-run controls). This work does not alter NBA forecasts, balances, recorded bets, the stock journal, odds API, or production deployment.

## Why

The original settlement command iterated every historical forecast whenever the owner asked to check results, potentially fetching a score for games with no paper position or already settled bets. It also silently used only the latest 100 forecasts. This was wasteful and difficult to audit.

## Files

- NEW src/lib/settlement-worklist.ts: deterministic planning based on existing position IDs, settlements, recorded results and published forecasts. Only unsettled positions after their start time need a result lookup. Prior verified results are reused and future matches skipped. Full 1000-row queries or missing forecasts stop safely.
- NEW src/lib/stocks/settlement-worklist.test.mjs: synthetic worklist fixtures.
- EXISTING src/lib/server/research-operations.ts: settleResearch now checks existing positions first and looks up only due/unfinished bets. Multiple games on the same date share an official ESPN scoreboard GET. Verified finals go through the existing immutable database result RPC; the existing SQL settlement RPC calculates the final payouts.
- NEW src/lib/stocks/settlement-runner.test.mjs: synthetic end-to-end function tests.
- EXISTING src/lib/stocks/paper-runner.test.mjs: update to its import mocking only. Existing placement tests preserved.

## Safety and limitations

- No new wagers or real-money orders. Existing virtual stakes and all original records remain intact.
- verifiedFinal still requires exact scheduled start, regular season, team identity, completed status and valid final scores. Missing or conflicting results never silently settle.
- A previously verified immutable result avoids another score-provider fetch. The database remains authoritative.
- Existing paper checks remain OWNER COMMANDED, not automatic background jobs. Any production scheduler requires separate hosting and authentication review.
- Missing pending forecast or full-size DB response fails closed rather than losing track of old bets.
- No Odds API usage; only explicitly invoked ESPN results checking would make public score requests.
- Payout arithmetic remains in the existing deterministic SQL service-role RPC.
- The latest-100 forecast reader still imposes a scale limit. A subsequent pagination upgrade is required as the experiment grows.

## Verification and release

Run Node tests, Python analytics tests, lint, Next.js build and TypeScript; inspect CI before merging. Staging owner-login and ESPN-to-database positive-path verification remain required and are not claimed by synthetic tests.

Next engineering gates: owner authentication staging check, durable command receipts, forecast pagination, quota-approved fresh odds ingestion, automatic settlement scheduling reviewed against hosting plan, then separate EPL/stock integration. Preserve both independent proposed $1,000 experiments; do not retroactively relabel legacy NBA bets.

No merges, production deployments, external sportsbook charges or activated automation in this milestone.
