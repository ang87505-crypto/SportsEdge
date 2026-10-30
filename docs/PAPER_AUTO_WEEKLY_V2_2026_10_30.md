# Weekly paper experiment `stock-v2-weekly-1`

Date: 2026-10-30. Requested by the owner: paper trading as soon as possible, accepting
that a weekly cadence and a smaller universe are untested. **This is not the frozen
research model and produces no evidence for it.** The frozen monthly model, its
bridge (`stock_forward_bridge_v1.py`), its 2026-only rule and its 2027 reserve are
unchanged.

## What differs from the frozen monthly model

| | Frozen monthly (v1) | Weekly paper variant (v2) |
|---|---|---|
| Decision day | First session of each month, 2026 only | First session of each ISO week, no year limit; once on the first session with `initial` |
| Universe | Every listed US common stock (about 4,000), needing a full security master | 136 large, liquid US common stocks in `config/paper-auto/universe-large-cap-v1.json` |
| Missing bars, unsupported corporate actions | Reject the whole decision | Skip that stock and name it in the diagnostics. A skipped stock that is **held** still rejects the decision. |
| Corporate-action coverage | Owner attestation required | Alpaca's feed as returned, labelled `alpaca-actions-unattested` |
| Scoring and selection | `stock-mom252-skip21-trend200-v1` | **The same mathematics.** `stock_weekly_scoring_v2.py` is generated from the frozen source with only the calendar rule replaced. A test proves the scores are identical on a session that starts both a week and a month. |

Everything else is unchanged and shared:
- the 08:00 New York decision with two observations (reference before 08:00, decision capture sealed within 60 s);
- the planner (10% of equity per target, whole shares, 50% gross cap, liquidity cap);
- the controller, the database, the STOP gate, the risk limits and the release switches.

The signal keeps the `stock-forward-signal-v1` artifact format the planner and the
database accept. It adds a `variant` block naming the weekly bridge, the scoring
version, the rebalance rule and the universe. The `scoringReportId` also hashes the weekly rule.

## Registration (`config/paper-auto/stock-v2-weekly-1.json`)

| Setting | Value |
|---|---|
| Account | A dedicated Alpaca PAPER account, reset to $10,000, flat |
| Capital limit | $12,500 |
| Maximum per order | $1,250 |
| Maximum per day | $12,000 |
| Orders per day / open orders | 20 / 10 |
| Attempts per leg | 3 |
| Drawdown stop | 25% |
| Decision window | 2026-10-30 to 2027-12-31 |

## Running it

1. **Register** (owner): Actions → *Recurring PAPER owner action (manual)* → `register`, `stock-v2-weekly-1`.
2. **Decide**: Actions → *Recurring PAPER weekly decision (manual)*, dispatched before 07:55 New York with the session date.
   Set `initial` = true only for the first session.
3. **Execute**: Actions → *Recurring PAPER worker (manual)* → `execute` during regular hours, more than 20 minutes before the close.
   - While `brokerWritesEnabled` is false, this records a shadow plan only.
   - Once writes are on, it reserves and sends the planned paper orders one leg at a time.
4. **Monitor**: the same worker → `monitor` after 16:15 New York records the daily mark.

STOP: **Record owner STOP** on `/stocks/paper-auto` (Preview, owner session). Also see
`docs/PAPER_AUTO_RELEASE_CHECKLIST_2026_10_17.md`.

## Known limits

- The paper fills are simulated. There is no spread cost, no market impact and no fees. A weekly cadence would pay noticeably more spread with real money.
- The universe is survivor-selected today, which is a bias. That is acceptable for an engineering paper run, and it's why nothing here is research evidence.
- Sector labels are maintainer-assigned GICS names, not licensed GICS data.
