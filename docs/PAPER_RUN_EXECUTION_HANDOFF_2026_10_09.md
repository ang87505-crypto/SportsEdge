# On-demand paper trading — tested execution planning milestone

User intent: the owner clicks **Run sports paper bets** or **Run stock paper trades**; the site chooses qualifying positions, records simulated transactions, then updates virtual balances automatically. One click authorizes one bounded run. New positions require another command; valuation/result updates for existing positions can run separately. No real-money routing.

## Completed now

Rechecked main at `261b03c`; PRs #17 and #18 remain draft/unmerged. Re-ran NBA 89 tests and stock 111 tests successfully. Added ONLY:

- `analytics/stock_execution_planner.py` — `stock-paper-bidask-plan-v1`, consumes model #18 target signals and trusted account/quote snapshots; plans sells before buys, exact whole shares/cents, explicit per-security fees/slippage, freshness/session/authorization checks, spend/exposure caps, and quoted account valuation.
- `analytics/test_stock_execution_planner.py` — 16 synthetic tests, including full model-signal-to-planner integration. No historical/live prices or performance claims.
- This handoff.

Branch `research/paper-execution-planner-20261009` is stacked on #18 at `1db25c4dbce44c065bc67e69e1a354ebc1bd962c`. No existing source, ledger or original PR branch edited. Run `python -m unittest discover -s analytics -p 'test_*.py' -q`: **127 tests pass** (111 inherited + 16 new).

The module is a **planner and valuation calculation**, NOT an activated runner or a second ledger. It does not place or persist a single trade. `planned_not_executed` and `SIMULATED_FILL_INTENT_NOT_EXECUTED` labels are intentional. The next adapter must apply approved intents through accounting, not treat a planned cash balance as actual recorded equity. PR #15 is not silently replaced; its fixed 10-bps accounting cannot represent arbitrary costs without a reviewed versioned extension.

## Planner contract and checks

`plan_run(signal, account, quotes, costs, *, authorization, now, session_open, session_close)` produces a deterministic plan ID, ordered simulated intents, before/current mark, projected cash/positions/equity and expected account revision. It does not mutate inputs.

- `signal`: exact output of `stock_momentum_v1.generate`, stored immutably by server. Strategy ID must match. Authorization binds both signal ID and hash of the entire signal object to prevent target substitution.
- `account`: account_id, integer revision, nonnegative cash_cents, positions mapping symbol -> positive whole shares, completed_signal_ids. Account values must come from an authenticated authoritative ledger, not browser input. All holdings must be included in the signal.
- `quotes`: mapping symbol -> matching symbol, quote_id, provider, observed_at, received_at, positive bid/ask decimal strings, tradable boolean, integer bid_size/ask_size. Require bid <= ask, observed <= received <= now, both timestamps within 60 seconds. No stale-price valuation or filling. Missing prices block the batch. Provider strings are declarations, not independent proof; the trusted importer must authenticate provenance and verify share-size units.
- `costs`: per symbol slippage_bps decimal text, fee_cents integer, assumption_id. No default 10-bps assumption. BUY references ask and adds slippage/fees, SELL references bid and subtracts them. Debits round up and proceeds down to cents; valuation uses midpoint with half-up rounding and also exposes bid-equity before costs. Returned equity is marked value, not realized profit.
- `authorization`: mode=paper, action=run_once, actor_id, run_id, signal_id, signal_digest, account_id, account_revision, signal_published_at, authorized_at, expires_at, max_buy_debit_cents. Time-limited to at most 24h and scope-bound. These are trusted-server assertions, NOT an authentication mechanism; never accept an arbitrary browser actor_id as proof of identity.
- Exact next-session open must match the signal. Trading must occur within that session; no same-close or weekend fallback. Calendar and source timing must be verified by the adapter. Quote availability is checked when planning; recheck immediately before receipt persistence.
- Current and projected 10%-per-name/50%-gross limits are rechecked. If spread/fees lower equity enough to breach a cap, fail closed and regenerate/re-authorize lower targets. No shorts/overspending or hidden leverage.
- Sells are planned before buys; use of projected proceeds is a simulator assumption, not broker buying power or T+1 settlement. Live broker execution (even paper) would need receipt reconciliation/settled-cash rules. Displayed-size constraints are conservative proxy checks, not proof of fill liquidity or queue position. No partial execution on planner failure.
- Completed signal IDs reject replay; run_id plus account revision must be enforced with durable database uniqueness and row locks. Pure Python checks alone do NOT prevent concurrent runs. Validate, claim and commit receipts atomically, with retry/resume and cached run responses; never retry an uncertain external order blindly.
- Corporate-action event reconciliation is not implemented here. The future ledger adapter must halt affected symbols until dividends/splits/mergers/delistings are reconciled. Marks alone cannot prove corporate actions were processed. A new reviewed account version or adapter is needed, preserving #15 events.

## Current production readiness (read-only DB check)

Three NBA forecasts, three NBA positions, zero settlements. **Zero fresh sportsbook quotes**; latest quote is 2026-10-08T22:52:38Z. No stock tables. No new wager or stock fill was made during this milestone. No paid data refresh or provider subscription was requested.

Existing server code already has `publishResearch`, `placeResearch`, `settleResearch`, protected by `SPORTSEDGE_INGEST_TOKEN` through the internal route. Placement/settlement DB RPCs contain immutable/idempotent checks. Current NBA policy is 1% available bankroll; proposed #14 100 x $10 cohort is separate and must not be relabeled or silently activated.

The public pages do not have an authenticated owner run action. Stocks are a manual $10,000 browser-local journal; do not overwrite it with the separate $1,000 automated study.

## Concrete site integration requiring approval of existing-file edits

The user's project rule requires explanation and approval before editing existing files. Proposed minimal edits:

1. `src/app/paper-betting/page.tsx`: add owner-only run control and last-run/result-refresh status; retain existing ledger table and balances.
2. `src/app/stocks/page.tsx`: add separate automated $1,000 study section with Run / current equity / cash / positions / source timestamps / last-run outcome; preserve manual journal and stored browser data.
3. `src/lib/server/research-operations.ts`: return truthful newly-created vs already-existing NBA position outcomes, bounded run counts and per-game skips. Current returned IDs can include already-existing positions; do not report all returned IDs as new bets.

New integration files would provide authenticated owner-session validation, server-only on-demand routes, durable idempotent run/stock-ledger records, quote/signal adapters, and separate background valuation/settlement jobs. Never put the ingest/service-role token in a client component. Login/account ownership must be resolved before a public mutation route exists. Preserve all existing authentication and architecture decisions; inspect environment/package docs before adding dependencies.

Default command flow:
- User chooses Sports or Stocks and sees virtual account and spend cap, then presses Run once.
- Server verifies owner/session/CSRF and account scope; claims unique run ID under revision lock.
- Sports: independently verified fixtures/models + fresh complete sportsbook markets -> eligible paper placements using the existing frozen policy. Zero eligibility is a legitimate result, not permission to lower rules.
- Stocks: verified as-of data -> monthly signals (#18) -> this planner -> approved accounting adapter. Between monthly rebalances show `No rebalance due`; update marks without forcing new trades. No filler picks to satisfy a requested count.
- Persist source-linked receipts and publish actual recorded account totals, then refresh display. Planned outcomes never become historical performance until recorded and sourced.
- Schedule result settlement and stock marks separately after reviewed deployment. New positions remain on-demand. Disable/stop prevents new orders; receipt reconciliation still completes outstanding records.

Production schema changes, merging and deployment remain pending review under the user's explicit rules. No scheduler was enabled. No provider credentials requested or exposed.

## Provider observations

Official Alpaca paper-trading documentation supports an eventual paper-only account adapter, but currently states paper simulation omits dividends, regulatory fees and several execution effects; free paper-only access is IEX data. A broker paper balance must therefore stay separate from a total-return research ledger unless differences are reconciled. No Alpaca account is connected by this PR.
Source inspected: https://docs.alpaca.markets/us/docs/paper-trading ; https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api . Do not assume consolidated coverage or buy a plan without approval.
