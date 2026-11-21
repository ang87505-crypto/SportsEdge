# Prospective stock evaluation protocol (read-only) and Codex interfaces (2026-11-20)

**Purpose.** Every historical period has been inspected, so the only untouched stock evidence is forward. This protocol
fixes, before any forward week exists, what will be measured and when a statement is allowed. It activates nothing,
changes no limit and sends no order. The Nov 23 supervised session is untouched.

## What is evaluated (frozen)

| Series | Definition |
|---|---|
| `current` | `stock-mom252-skip21-trend200-v1`: whole shares from $1,000, 10% per pick, 50% gross cap, $95 cap, weekly (the live paper rules) |
| `holdrank10` | `stock-mom252-skip21-trend200-holdrank10-v1`, the same sizing (registry `lab-stock-holdrank10-wholeshare`, RUNNING, forward only) |
| SPY matched | SPY at each strategy's own realized average gross in the forward window |
| SPY 50% | the total-account benchmark for the 50% gross policy |
| SPY 100% | context only (a different risk policy) |

**Window.** Sessions from **2026-11-19** (after the last historical data end, 2026-11-18). The first weekly decision
in the window is the week of 2026-11-23. Both series start from $1,000 at the window start, with no history carried in.

**Reported per series** (`analytics/stock_forward_protocol_v1.py`, `forward_report`):
- total return, Sharpe, Sortino, maximum drawdown;
- average and minimum gross, idle-cash share, idle cash within the 50% cap;
- decisions, rejected decisions, cash-blocked decisions;
- traded value, costs at 10 bps, turnover per average equity;
- the same metrics at 25 bps;
- the number of forward weeks.

**Provenance and missing data, every run:**
- the dataset SHA-256, feed, `asof` date and universe revision;
- members without a bar on a window session, and missing SPY bars;
- the full data audit (`analytics/stock_data_audit_v1.py`): gaps, bad prices, inferred corporate actions, unexplained
  steps, and the truncation leakage check.

## When a statement is allowed

- **Minimum:** 26 forward weeks, the registry `minWeeks`. Before that, `status = INSUFFICIENT_FORWARD_WEEKS` and no
  comparison is stated.
- **After 26 weeks**, the report states three things, and nothing else:
  1. whether holdrank10 beats current;
  2. whether holdrank10 beats SPY at its matched exposure;
  3. whether current beats SPY at its matched exposure.
- **Promotion rules are unchanged.** A stock challenger reaches owner review only if it beats the live rules **and**
  SPY at its own exposure forward. Nothing in this protocol promotes, registers or activates.

## How to run it (read-only)

Each dispatch of the manual `stock-weekly-backtest.yml` (any round; set `end` to the last **completed** session) now
ends with the no-network audit and forward report, printed between `AUDIT_JSON_*` and `FORWARD_JSON_*` markers.

```bash
gh api -X POST repos/ang87505-crypto/SportsEdge/actions/workflows/stock-weekly-backtest.yml/dispatches -f ref=main -f 'inputs[end]=<last completed session>' -f 'inputs[round]=3'
```

**Constraint found:** an end date of the current day fails with HTTP 403 on the free SIP data plan. Always use the last
completed session.

Locally, on a downloaded bars file:

```bash
python -m analytics.stock_forward_protocol_v1 --universe config/paper-auto/universe-large-cap-v1.json --data bars.json.gz --output forward.json
```

```bash
python -m analytics.stock_data_audit_v1 --universe config/paper-auto/universe-large-cap-v1.json --data bars.json.gz --output audit.json
```

**First run** ([44852266554](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44852266554), end 2026-11-19):
1 forward session, 0 decisions, 0 weeks, `INSUFFICIENT_FORWARD_WEEKS`; no missing window bars.

## Interfaces for Codex (recommendations; nothing here modifies Codex's systems)

Codex owns storage, workers, deployments and broker execution. Suggested integration, owner approval first:

1. **Weekly read-only job.** After the weekly decision's session has closed, dispatch the backtest workflow with
   `end` = the last completed session. Persist `audit.json` and `forward.json` in an append-only research ledger, for
   example `research-data/stock-forward/<end>/`, which the planner never reads. Cost: about 77 read-only market-data
   GETs per run, the same as a backtest.
2. **Implementation shortfall.** Call `live_vs_replay(live, replay_curve)`:
   - `live` comes from the existing after-close reconcile snapshots (`{date, equity, external_flow}`);
   - `replay_curve` is the `current` curve from `forward_report` over the same window.

   This measures how far real limit-order fills fall short of the open-price replay. Weeks with deposits or withdrawals
   are excluded, never netted. Statements only after 26 periods.
3. **Idle cash.** PR #198's `shadow_week` / `summarize_shadow` use the same snapshots. The two can share one weekly job.
4. **Corporate-action archive.** Archive Alpaca's corporate-action responses (read-only, existing key) with each
   decision capture. They are already fetched for the live bridge. Archiving them historically enables:
   - replaying the live skip rule in backtests (audit gap A);
   - cross-checking unadjusted spin-offs (gap B).
5. **SEC v2 audits.** In the existing approved intake (`scripts/research-intake-collect.ts`), also run
   `parseCompanyFactsV2` → `durationAmbiguity`, `restatementReport` and `identityCheck`, and store their outputs. This is
   a small change to an approved collector, so it is Codex's to make. It enables no new source and no new request.

## Evidence that would justify the next genuine algorithm experiment

1. **Point-in-time constituents** (licensed, owner decision). This is the only way to get untouched, survivorship-free
   *historical* evidence: re-test momentum and holdrank10 on a universe that includes names that later failed. A stock
   rule that still beats SPY at matched exposure there would be the first real evidence of selection skill.
2. **26 forward weeks of the protocol above**, especially:
   - whether holdrank10's turnover advantage persists;
   - whether the live account matches its replay (implementation shortfall).
3. **SEC v2 on real filings**, before any quality or value signal is proposed:
   - duration-consistent, point-in-time fundamentals;
   - restatements separated from comparatives;
   - CIK identity verified.
4. **Corporate-action reconciliation** (gaps A and B), so backtest and live treat spin-offs identically.

**Without at least one of 1–2, any new stock-selection variant would again be tested on inspected, survivor-only data.**
That is the situation the last four milestones ended in, and it should not be repeated.
