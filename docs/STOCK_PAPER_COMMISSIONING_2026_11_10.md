# Proposal: one commissioning session for `stock-v2-weekly-1` (2026-11-10)

**Status: PROPOSED, needs owner review.** This changes a registered rule (when a decision may be taken).
Merging this pull request is the approval. Without that merge, nothing below happens and the first paper-order
session stays **Monday 2026-11-16** under the registered weekly rule.

## Why

- **Nov 9 decision:** Monday Nov 9 produced a genuine weekly decision with targets (`TARGETS`, decision
  `83d56fc4…`, run 42592177611, captured 08:00 New York).
- **No orders that day:**
  - The only in-session execute ran on `main`, where PAPER order writes are released OFF, so it recorded a
    shadow plan only (`SHADOW_PLAN_ONLY`, run 42684157948).
  - No execute ran on the reviewed release branch.
  - The scheduled execute slots started after the close.
- **Why this cannot be fixed later in the week:** the controller executes only a decision made for the same
  session (`decision.session === today`). The bridge decides only on the first session of an ISO week, or once
  on the experiment's first session (`initial`, used on 2026-10-30). Under the registered rules the next
  decision is therefore Monday Nov 16.
- **The account is flat.** No strategy order has ever filled (`heldSecurities: 0`).

## The proposed rule change

One additional decision point, on exactly one named session: **Wednesday 2026-11-11** (in
`config/paper-auto/stock-v2-weekly-1-commissioning.json`).

| Item | Rule |
|---|---|
| Inputs | A **fresh** capture for that session: the reference capture before 08:00 New York and the decision capture from 08:00:00, sealed within 60 seconds. The same capture rules as every weekly decision. Monday's inputs are never reused or relabelled |
| Mathematics | The frozen weekly scorer, unchanged. It is called exactly as for the experiment's first session. A test asserts the targets are identical to an initial-session decision on the same data |
| Label | The decision and its signal carry `rebalance: weekly-commissioning-session` |
| Universe, model, sizing, caps | Unchanged: registered universe, `stock-mom252-skip21-trend200-v1`, capital limit $1,250, $150 per order, $1,200 per day, 20 orders/day, 10 open orders, 3 attempts per leg, 25% drawdown stop |
| Holding period | Held until the next registered decision, Monday Nov 16, which runs under the normal rule and may rebalance |
| Execution | The same supervised sequence as any first session (below). The owner gate, duplicate protection, unknown-order handling and same-day rule are unchanged |

## Code-enforced guards

- The session must equal the one in the reviewed file, the file must say `"approved": true`, and its
  `experimentId` must match. Any other day, experiment or a missing file gives the registered rule.
- **Flat account only.** If any security is held, the decision is recorded `INPUT_REJECTED` with
  `COMMISSIONING_REQUIRES_FLAT_ACCOUNT`.
- If the named session is a regular week start, the registered rule applies and the label stays
  `weekly-first-session-of-iso-week`.
- After the named date the file has no effect. It can be removed in a later clean-up.

## What it costs

- **Turnover:** one extra entry, and possibly a rebalance on Nov 16 with up to $1,200 of paper turnover.
- **Pause path:** paper only, no real money.
- **Record:** a three-session holding period that the registered weekly rule would not have produced. It stays
  visibly labelled in the ledger, so the forward record can separate it from the regular weeks.

## Supervised sequence (same for this day or Nov 16)

1. **Before 07:55 New York:** the scheduled decision run (Vercel kickoff 09:00–09:59 UTC, GitHub 11:20 UTC) picks
   up the file and records the decision at 08:00.
2. **Owner gate:** it must be **ARMED** by the owner, with a fresh clean account check.
3. **After 09:30 New York:** one execute run is dispatched on the reviewed branch `release/stock-paper-orders`.
   Check actual Alpaca PAPER order IDs and fills.
4. **Owner presses Stop** on the Autopilot page. A clean reconcile follows (owner **Start** runs one before
   re-arming).
5. **After the close:** the monitor records the day's mark. The release watcher can then verify every receipt
   and merge PR #102.

## Not changed

- Registration and decision window.
- Risk caps and broker code.
- Main's release manifest (writes OFF until #102 merges).
- The frozen November 10 daily shadow experiment.
- Research records and failed candidates (all inactive).
