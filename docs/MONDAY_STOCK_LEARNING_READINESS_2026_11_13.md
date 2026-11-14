# Monday 2026-11-16: Alpaca PAPER first-session readiness and learning evidence

Prepared Friday, November 13, 2026. Read-only work; no PAPER orders submitted.
Production: https://sports-edge-eta.vercel.app
Owner dashboard: https://sports-edge-eta.vercel.app/stocks/paper-auto
Manual PAPER worker: https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-worker.yml
Release PR #102: https://github.com/ang87505-crypto/SportsEdge/pull/102
Read-only learning/preflight PR #171: https://github.com/ang87505-crypto/SportsEdge/pull/171

## Summary
- Monday first-stock-session engineering: PREPARED FOR OWNER-SUPERVISED TEST, NOT YET LIVE-VERIFIED.
- Main release: paperOnly:true, scheduledRunsEnabled:true, brokerWritesEnabled:false, realMoneyEnabled:false.
- Draft PR #102's pinned release/stock-paper-orders branch has brokerWritesEnabled:true for a manual, supervised PAPER branch run. Its controller, broker adapter, store, timing, Python weekly bridge and experiment config are identical to main at the compared revisions. It is 93 commits behind main, but the non-release executable worker differences observed in the review are commentary/text, plus workflow/test declarations. Do not rebase or change pinned head without re-reviewing release gates.
- The public ops-status/status.json generated 2026-11-14T01:25Z says production matches main, weekly stock decision + early kickoff + worker last success, release gate STOCK_SUPERVISED_EXECUTE_REQUIRED, PR #102 open/draft. Scheduled worker slots have been missed/delayed; never rely on planned cron times alone.
- Private PAPER Supabase ledger project vfyzbliksooljxrlfadp is not accessible to the ChatGPT connected Supabase account. This prohibits a claim that Alpaca account credentials, exact broker balances, owner gate, clean reconciliation or fills have been independently checked. The owner must verify them in the authenticated dashboard/worker receipts. Do not add credentials in chat.

## What the learning mechanism already records in the DB
The sealed weekly decision uses analytics/stock_weekly_bridge_v2.py with an 08:00 ET decision and a <=60-second source capture. The sportsedge_paper_auto.decisions table stores a per-session model version, input digest, scoring report ID, signal JSON with full members and prior inputs for TARGETS/HOLD, diagnostics and immutable decision timestamp. The database makes these rows append-only. Intents link each proposed order to decision_id and retain immutable identity, limits and price; order transitions and broker activities are tracked separately. Daily equity contains close marks; current evaluation only counts cash-reconciled, uncontaminated marks against starting equity and matching SPY window.

The new pure paper-auto-learning-evidence.ts owner read model checks that visible intents link to frozen decisions before order creation. It counts actual positive-fill intents and verified daily marks, but does not count filled intents as closed winning trades or one day of returns as calibrated skill. The bounded dashboard view (36 decisions/200 intents) cannot prove all-time completeness; the underlying append-only DB signal remains authoritative.

Not implemented automatically: self-training or promoting a new stock algorithm from Monday's results. The registered model ranks stocks and produces targets, not calibrated per-trade 60% probabilities. To calculate trade win rate we must reconcile completed lots/attributed realized P&L, include costs consistently, and preserve immutable pre-trade signals. No new live model should be activated from one session.

## Monday owner steps (Albuquerque MST; New York two hours ahead)
1. By about 6:00 AM MST (8:00 AM ET): Look for a real TARGETS decision sealed in the Monday weekly decision receipt from the early Vercel kickoff. The GitHub backup schedule has historically fired late; only the sealed timestamp counts. If HOLD, MISSED or INPUT_REJECTED, do not force or backfill a trade.
2. Before about 7:30 AM MST: On the owner dashboard check stock-v2-weekly-1, correct PAPER account, checks clean, no unresolved intents or outside orders, no critical alerts. Press Start only if not already armed and clean. Start does not enable PAPER writes on main.
3. During Monday session, after valid TARGETS and owner Start: Run the GitHub manual PAPER worker; select branch release/stock-paper-orders, kind execute, experiment stock-v2-weekly-1, trigger manual. Verify posts>0 and genuine PAPER fills from Alpaca, not merely green workflow/shadow plan. Never re-dispatch an unknown outcome.
4. After fills but before 2:00 PM MST close (4:00 PM ET): Stop autopilot, complete clean reconciliation, then Start to re-arm after reconciliation.
5. After 2:00 PM MST close: Verify a real, uncontaminated, cash-reconciled same-session daily mark and matching SPY reference. One broker snapshot alone cannot prove strategy return.
6. Release review: Verify PR #102's pinned scripts/paper-release-gates.mjs against same-day authenticated receipts. Only the owner can explicitly approve a merge; no unattended order-release activation or model/risk changes.

Emergency: Press Stop autopilot immediately, and also check/cancel working PAPER orders in Alpaca's official dashboard. Never blindly retry uncertain POSTs.

## Check-only engineering commands
From repo root with ops-status/status.json saved as a local file named status.json:

    node scripts/stock-monday-preflight.mjs status.json
    node --test scripts/stock-monday-preflight.test.mjs src/lib/stocks/paper-auto-learning-evidence.test.mjs

This preflight never authenticates to Alpaca, makes orders, arms the gate or reads credentials. PREPARED_FOR_OWNER_SUPERVISED_PAPER_TEST does not mean LIVE_APPROVED.

## Evidence needed for learning after Monday
- Sealed model version, decision ID, as-of timestamp and full input digest.
- Linked order intents and attributed broker order/fill activities.
- Clean daily equity mark and matching SPY reference, with missing/unreconciled sessions explicit.
- No-trade, partial, rejected and canceled sessions preserved without fake fills.
- A growing sample of independent future sessions and actual CLOSED-LOT outcomes for trade win rate, mean winner/loser and risk across regimes.
- Only then train shadow models on earlier data and evaluate later periods out of sample; never auto-promote.

## Freeze / change control
PR #171 changes only read-only owner UI parsing, evidence summary, tests, preflight and this document. No SQL migration, broker controller, scheduler, release flags, risk limits, algorithm, Supabase production row, owner gate, real money or PR #102 pinned head is modified. Keep PR separate from #102 and do not merge if CI fails.
