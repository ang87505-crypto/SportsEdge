# Kalshi setup status — 2026-11-15

## Decision

Continue the Kalshi build in an isolated research branch. Do not modify the stock PAPER release branch, order controller, stock schedule, risk limits, sports capture budgets, production credentials, or production release switches.

The current SportsEdge Kalshi work is a **research scaffold**, not a live exchange connection. The software contains offline market/order-book normalization, hypothetical fee-aware paper-forecast logic, official-settlement validation, and evaluation code. No Kalshi account, API key, live quote, order, or market-data archive is connected.

## What is already operating

- The K0 code and the NOAA-only independent weather-memory workflow were merged in PR #170 on 2026-11-14.
- The NOAA-only workflow is scheduled and has already archived two immutable pre-event Central Park grid forecasts:
  - Target date 2026-11-15, captured 2026-11-14T10:19:35Z: forecast high 50°F; zero historical training pairs.
  - Target date 2026-11-16, captured 2026-11-15T07:49:49Z: forecast high 52°F; zero historical training pairs.
- Both are NWS grid forecasts, not Kalshi probabilities, executable quotes, station observations, market settlements, or proof of edge.
- At this snapshot, no next-morning CLINYC outcome, independent grade, or forward scorecard had been archived. The November 14 outcome run failed because the report parser expected a `TODAY` heading while the actual CLINYC full-day report uses `YESTERDAY` for the completed report date. The official product format is visible at https://tgftp.nws.noaa.gov/data/raw/cd/cdus41.kokx.cli.nyc.txt.
- A narrow regression fix is being prepared in this branch: accept the actual `YESTERDAY` label as well as the legacy `TODAY` label, with tests for both. This only reads government weather data and does not contact Kalshi.

## Kalshi exchange-data permission boundary

Two separate official documents matter:

1. The Kalshi Data Terms of Use say personal non-commercial access does not include software development using Kalshi Data, including AI/ML, without prior written consent. They also restrict collecting, copying, analyzing, and using Kalshi Data in AI/ML without permission: https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf
2. The Kalshi Developer Agreement says API use is limited to facilitating a member's own trading, and API data may not be collected, cached, aggregated, or stored except to facilitate that member's own trading: https://kalshi-public-docs.s3.amazonaws.com/Kalshi-Developer-Agreement.pdf

SportsEdge's present requested feature is private research and paper forecasting, not a live own-account trading interface. Therefore **do not make real Kalshi API requests or store/derive Kalshi quotes for this research workflow unless Kalshi gives written authorization that specifically covers the proposed software, research/paper use, retention, derived metrics, and any AI-assisted use**. Existing permission environment flags are safeguards, not permission; do not set them speculatively.

A written request is drafted but has not been sent:
`docs/KALSHI_API_PERMISSION_REQUEST_2026_11_13.md`.

## First useful release after permission

1. Confirm written permission and exactly which fields, quote retention, derived statistics, and AI usage are allowed.
2. Verify the current production API schema and a single supervised read only after permission is documented.
3. Start with one weather series and exact contract settlement source/rules. Do not widen to economics or sports until each product's series, fee schedule, settlement source, and jurisdiction are checked.
4. Use a private, owner-only quote and forecast ledger with pre-lock timestamps, exact order-book depth, fee/slippage assumptions, and simulated fill/partial-fill/no-fill. Never publish Kalshi raw quotes to the public NOAA research-data branch.
5. Grade against the exact official Kalshi final settlement, not an NWS forecast or preliminary climate report. Report Brier/log loss, market benchmark, costs, drawdown, independent event counts, and forward holdout results. Do not call hypothetical marks realized returns or profitability.
6. Keep all actual trading paths disabled until a separate explicit authorization and independent legal/security review.

## Separate Monday stock PAPER release status

Monday 2026-11-16 is the planned owner-supervised first stock PAPER acceptance session, not a fully released automatic trading system:

- PR #102, `release/stock-paper-orders`, is still draft and unmerged.
- Its CI checks are green on the pinned commit, but the project handoff still requires a fresh owner-side account check, a genuine supervised first PAPER execute with confirmed fills, owner Stop, clean reconciliation, restart/Start verification, and the same-session daily mark.
- PR #171 is also draft and read-only; it adds the owner learning-evidence panel and preflight, but does not activate orders.
- The reported main-branch flags remain `scheduledRunsEnabled=true`, `brokerWritesEnabled=false`, `realMoneyEnabled=false`. The PR #102 branch contains the proposed PAPER release switch but is not merged.
- This Kalshi branch does not touch any stock PAPER code or release gate.

## Safe scope of this branch

- Fix the NOAA CLINYC outcome parser and add regression tests for the actual NWS format.
- Make the Kalshi page accurately describe the merged K0 scaffold and active NOAA-only archive, while clearly showing that Kalshi market-data collection is disabled.
- Keep all exchange networking, exchange credentials, quote storage, trading, paid services, database migrations, and release changes out of scope.
