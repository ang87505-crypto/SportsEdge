# Recurring Alpaca PAPER controller v1: design, evidence and release checklist

Date: 2026-10-17. **Status: code-ready and disabled.**
- No migration has been applied anywhere.
- No secret is configured.
- No workflow is scheduled.
- No broker order has been sent.

Everything below that changes a system needs separate, explicit owner authorization.

## Release switches (all OFF in source)

`src/lib/stocks/paper-auto-release.ts` holds three switches:
- `brokerWritesEnabled: false`. The real Alpaca adapter refuses POST and DELETE before any network call. An execute run therefore records a **shadow plan** and never reserves or sends an order.
- `scheduledRunsEnabled: false`. The worker exits with `SCHEDULED_RUNS_RELEASED_OFF` before any network call when triggered by a schedule.
- `realMoneyEnabled: false`. The only broker host is `paper-api.alpaca.markets`, and market data comes from `data.alpaca.markets`.

`.github/workflows/paper-auto-worker.yml` is `workflow_dispatch` only. CI fails if a `schedule:` block appears in it.

## What runs where

| Piece | Where | Role |
| --- | --- | --- |
| `database/staging/paper_auto_v1.sql` | Supabase **staging** (not applied) | Authority for STOP, leases, claims, caps, receipts, decisions and the daily ledger. See `docs/PAPER_AUTO_CONTROLLER_SCHEMA_V1_2026_10_17.md`. |
| `paper-auto-controller.ts` | worker | One slot per call: reconcile, manage working orders, plan, submit, record. |
| `paper-strategy-rebalance.ts` (PR #67) | worker | Astra's frozen planner. It sizes every leg; the controller never changes a target, a quantity or a limit price. |
| `paper-auto-broker.ts` | worker | Paper-only Alpaca adapter. It never retries a POST, never follows redirects, bounds every reply, and parses money exactly. |
| `paper-auto-store.ts` | worker / server | PostgREST adapter pinned to the staging project. It tells a database refusal apart from an unknown outcome. |
| `scripts/paper-auto-worker.ts` | GitHub Actions | CLI entry point. It writes one JSON line and exits 1 when the owner must act. |

### Slot behaviour

- **execute**
  1. Takes the lease.
  2. Looks up every live or unresolved intent by client order id.
  3. Compares open orders and positions with the fill ledger.
  4. Records attributed activities.
  5. Then, only if the gate is `ARMED`, the account matches and nothing is unresolved, checks the following:
     - the decision is today's;
     - the slot falls between the open and the close minus 20 minutes;
     - the clock agrees with the broker;
     - quotes are fresh;
     - the drawdown limit and the capital limit hold.
  6. Calls the planner, reserves the plan's phase, and claims and POSTs one leg at a time.
  7. Polls for fills, records its own fills, and re-plans the BUY phase after the sells are final.
  8. Cancels working orders that have been resting for more than 5 minutes, and re-plans the residual as a new attempt.
- **reconcile** produces the clean evidence that `resume` requires.
- **Kill switch.** While the gate is `STOPPED`, the execute and reconcile slots cancel every working strategy order before any external-state check, so a manual order left in the account cannot keep strategy orders working. A run that stops the experiment itself cancels working strategy orders in the same run, best effort. It never cancels the owner's own orders, and never cancels anything when the broker reports a different account.
- **monitor** records final order states, activities and the after-close daily mark, only on the session's own evening (an earlier session's slot is skipped as `MARK_WINDOW_PASSED`, never relabeled).
  - When external state is present, it still records the mark as contaminated, then stops.
  - The database reconciles cash against every recorded activity. Cash that no activity explains (an account reset, an unreported credit) stops the experiment as `UNEXPLAINED_CASH_CHANGE`. While a submission is unresolved, the mark is recorded unreconciled and the run is blocked as `MARK_PENDING_ATTRIBUTION`; the next mark reconciles once the order is found.
- **decision** records the frozen strategy's decision for the session, including HOLD and MISSED.

### When the experiment stops

The experiment STOPs, with a critical alert, on any of the following:
- an external open order;
- a position the fill ledger does not explain (fills still in flight are tolerated);
- an external or unsupported activity, such as a deposit, a journal or a corporate action;
- after-close cash that no recorded activity explains;
- a different broker account;
- a broker rejection, whether the POST is refused or a working order is rejected later;
- a broker order that mismatches its intent or disappears;
- the drawdown or capital limit;
- an unreconciled position identity.

The database itself stops the experiment, in the same transaction, when it records a broker rejection, an external or unsupported activity, or (while no submission is unresolved) a daily mark whose cash no activity explains. The worker's own stop call afterwards adds no second alert, and losing that call cannot leave the experiment ARMED. Every other STOP-worthy state (an open order, a position, the account, a limit) persists at the broker and is detected again by every run.

Planner refusals, clock skew and refused reservations block only the run, with a warning. A rejected or exhausted leg is never retried. Because the plan is all-or-nothing, it then stays blocked for that decision rather than being silently trimmed.

## Scheduling assessment (target: $0)

- **Vercel Hobby cron:** runs once a day with ±59-minute precision, on Production only. That is unsuitable for 08:00:00 decisions and intraday slots, and nothing on Vercel is changed here.
- **Supabase Free:** pg_cron and pg_net exist, but Edge Functions have 2 s of CPU and 150 s of wall clock and run on Deno. Projects pause after a week of inactivity. Not used for execution.
- **GitHub Actions (chosen):** free for this private repository within the monthly minute allowance.
  - Schedules are best effort: they can be delayed or dropped and run from the default branch only.
  - The worker is idempotent per UTC quarter-hour slot, and duplicate or late deliveries are harmless:
    - a finished slot is skipped;
    - a running slot is skipped;
    - a stale run is abandoned and retried, up to 5 attempts;
    - a late slot refuses to trade.
  - DST correctness comes from New York session checks, not from cron.

A schedule is **proposed, not enabled**. It needs a reviewed PR that also sets `scheduledRunsEnabled: true`. All times are New York; the worker re-checks every time.

```yaml
# on:
#   schedule:
#     - cron: '20,40 11,12 1-7 * 1-5'      # decision prefetch, both UTC offsets; waits for 08:00:00 ET
#     - cron: '*/15 13-20 1-7 * 1-5'       # execute slots, first week of each month only
#     - cron: '35 20,21 * * 1-5'           # monitor after the close (16:35 ET, either offset)
```

Estimated cost: about 140 execute runs plus about 44 monitor runs per month at roughly 20 to 40 runner-seconds each. That is about 1.5 hours a month, inside the free allowance.

Alerting is $0:
- A STOPPED or FAILED run exits 1, so GitHub sends its failed-workflow notification.
- `status.lastCheckAt` older than 26 hours shows as `BLOCKED` on the dashboard.

A browser tab, a laptop or a long-lived serverless function is never relied on.

## Data and fidelity limits (not hidden)

- **Limit prices:** the free market-data plan provides real-time **IEX** quotes only, so execution limit prices are IEX-based. Signal liquidity (`prior_adv20_shares`) comes from the bridge's consolidated SIP history, not IEX.
- **Paper fills:** Alpaca PAPER fills are simulated. There is no market impact, no queue position, and no regulatory fees or dividends. They are **not** achievable real-money returns.
- **Daily marks:** account equity read after 16:15 New York on the session's own evening. Any external flow contaminates every later mark, and unexplained cash leaves a mark unreconciled (see the schema document). The SPY benchmark is the raw SIP daily close, a price return, consistent with an account that receives no paper dividends.
- **Settled cash:** cash minus the current session's sale proceeds, which settle T+1. It is enforced by both the planner and the database.

## Verification evidence (local, disposable PostgreSQL 16; CI runs on 17)

| Suite | Result |
| --- | --- |
| `database/tests/paper_auto_v1.sql` (pinned clock) | PASS: 127 refusal and 100 equality assertions. 29 of 29 schema guard mutations caught. |
| `database/tests/paper_auto_v1_race.sh` (independent connections) | PASS, three repeated runs. |
| `paper-auto-broker.test.mjs` (adapters, no network) | 12 of 12 pass. |
| `paper-auto-controller.test.mjs` (fake broker plus the real schema) | 21 of 21 scenarios pass. 15 of 15 controller guard mutations caught. |

The controller scenarios cover:
- the happy path, idempotent slots, HOLD and the daily mark;
- shadow mode with writes OFF;
- an unknown POST outcome, never retried, found later and then completed;
- a duplicate client id resolved by lookup;
- a rejection that STOPs, with no retry after resume;
- a working order the broker rejects later, which STOPs and cancels the other working legs in the same run;
- an external order, an external position and a wrong account;
- stale quotes and late slots;
- a partial fill, canceled when stale, with the residual re-planned;
- the STOP kill switch, including with a manual order left in the account: after an owner STOP, while armed, and with the worker's own stop call lost. The owner's order is never touched;
- a different account behind the credentials, which stops without canceling anything in it;
- the database's atomic stops: a benchmark read that fails after a deposit is recorded, a lost stop call after unexplained cash, and a lost stop call after a rejection, after which the next session's decision is never executed;
- duplicate and overlapping deliveries;
- a SELL-then-BUY rotation across the DST change, with a slow SELL fill and T+1 settled cash;
- a deposit that contaminates the mark and STOPs;
- a late delivery that cannot relabel an earlier session, and unexplained cash that STOPs;
- a mark during an unresolved submission that blocks, then reconciles the next session;
- drawdown from a real after-close high-water mark;
- a MISSED session.

Passing CI does **not** show that any real broker order was executed.

## Release checklist (each step needs explicit owner authorization)

1. Review and merge, in order: the schema PR, the controller PR, the signal bridge and the dashboard. Astra reviews how the planner and signal are used.
2. Create a **dedicated** Alpaca PAPER account with new keys. It must not be the one-order acceptance account. Confirm it is flat, with no open orders.
3. Apply `paper_auto_v1.sql` to **staging** Supabase only. Run the SQL suite against a disposable copy first.
4. Add GitHub repository secrets:
   - `SPORTSEDGE_STAGING_SUPABASE_URL`
   - `SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY`
   - `ALPACA_PAPER_AUTO_KEY_ID`
   - `ALPACA_PAPER_AUTO_SECRET_KEY`
5. Register each experiment from the owner-only path. Registration checks that the account is active, flat, below the capital cap, and starts `STOPPED`. Suggested values:

   | Setting | Suggested value |
   | --- | --- |
   | Capital limit | $1,200 |
   | Maximum per order | $150 |
   | Maximum per day | $1,000 |
   | Orders per day | 20 |
   | Open orders | 10 |
   | Attempts per leg | 3 |
   | Drawdown stop | 25% |
   | Fee reserve | 0 |

6. Run a shadow period with writes OFF:
   - dispatch `reconcile`, then `execute`, and confirm a `SHADOW_PLAN_ONLY` result that matches an independent planner run;
   - record decisions with the bridge;
   - dispatch `monitor` after the close.
7. Merge a reviewed PR that sets `brokerWritesEnabled: true` and nothing else.
8. Dispatch `reconcile`, then resume as the owner (compare-and-swap on the gate version).
9. Dispatch the first `execute` manually during regular hours, then reconcile as described below.
10. Only after a clean first session, merge a reviewed PR that adds the schedule above and sets `scheduledRunsEnabled: true`.

### Reconciling the first session

Do this after step 9:
- every intent is in a terminal or working state that matches the Alpaca order looked up by its client order id;
- positions equal the fill ledger;
- activities are attributed;
- the daily mark is recorded.

Any `uncertain` intent is resolved only by:
- a later broker observation; or
- the owner's `confirm_absent`, after 16:15 New York, with a client-id lookup and a complete order-history check.

### Rollback, at any time

- **STOP** from the owner path. It is immediate for new orders. Working DAY orders are canceled by the next execute or reconcile run, even while external state persists, or expire at the close.
- Disable the workflow in the GitHub UI, or revert the release PR. Cancels use the same broker-writes switch as orders, so reverting the writes release also stops the kill switch from canceling. STOP first and let one execute or reconcile run cancel working orders, or cancel them in the Alpaca dashboard. DAY orders expire at the close either way.
- STOP never needs a deployment.

## Not done and why

- No migration has been applied, no secret has been set, no account registered, and no order or cancel sent: each needs owner authorization.
- The current-data signal bridge (`docs/STOCK_FORWARD_BRIDGE_V1_2026_10_17.md`) cannot yet source the registered universe faithfully. Alpaca provides no security type, sector or first trading date. Missing bars and unsupported corporate actions reject the whole batch under the frozen rules. Until Astra registers those policies and an authenticated security master, decisions will be `INPUT_REJECTED`.
