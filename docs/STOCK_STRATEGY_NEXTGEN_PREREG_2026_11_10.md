# Pre-registration: next-generation stock research slate (2026-11-10)

Committed **before** any result for these candidates was computed. Research only:
- no broker order, no paper order and no activation;
- no change to `brokerWritesEnabled`, `scheduledRunsEnabled`, owner gates, release pins, Vercel schedules or the
  frozen weekly autopilot.

Failure is a valid outcome, and SPY buy-and-hold is a legitimate winner. After results are seen, these rules are not
changed. A data-integrity correction would be a dated amendment, written before any rerun, with earlier outputs kept.

## Status of the evidence

- **Window:** 2017-02-01 to 2026-11-06, the same as `docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md`.
  - The project has **already inspected** this window, so every comparison here is **exploratory**. 2023–2026 is not
    a holdout.
  - Confirmation can only come from forward data after this date.
- **Universe:** `config/paper-auto/universe-large-cap-v1.json` (136 current large caps). It is **survivorship-biased**:
  no point-in-time membership list is available, and current ETF holdings are never substituted. Renamed members
  are joined by the existing entity checks (META/METV, MMC/MRSH).
- **Engine:** the existing engine and its execution rules:
  - decide at the close, execute at the next open;
  - sells first;
  - limit-on-open buys at +3%;
  - whole shares, no borrowing;
  - corporate actions applied;
  - unresolved positions block buys;
  - cash earns 0%.

## Baseline B0 (immutable)

`momentum-quality-paper-v1`, unchanged:
- **Signal:** top 20 by 252→21-session momentum, then ranked by **fraction of positive daily returns**. This is a
  *price-consistency* feature, **not** fundamental quality, and the name is historical.
- **Portfolio:** 5 names, at most 2 per sector, 20% each, monthly rebalance.
- **Paths:** the continuous path and the owner-halted path (10% halt, no simulated restart).

## Candidates (one change each from B0)

| ID | One change from B0 | Exact rule |
|---|---|---|
| `mq-recovery-v1` (V1) | Simulated recovery after a halt | Halt as B0 (close ≤ 90% of peak → sell everything at the next opens). **Cooldown:** cash for 20 completed sessions after the liquidation finishes. **Then waiting:** at each regular month-end decision, re-enter only if SPY's adjusted close at the signal close is above its 200-session simple average of adjusted closes; otherwise stay in cash. **Partial:** at re-entry every target weight is halved (exposure ≤ 50%) and the halt peak is reset to equity at the re-entry signal close. **Full:** after 3 partial month-end decisions without a new halt, and with SPY still above its average at that decision, weights return to 20%. **Fall-back:** at any month-end decision in partial state with SPY at or below its average, the portfolio goes to cash (waiting). Any new 10% breach starts a new halt and cooldown. A **research proposal only**; the production owner-only stop/resume is unchanged |
| `mq-buffer-v1` (V2) | Rank buffer | A currently targeted name is kept if it is still in the momentum top 20 **and** among the first 10 of the positive-fraction ranking, subject to the sector cap. Remaining slots are filled in ranking order. Selection count, sector cap and the engine's 20% rebalance band are unchanged |
| `mq-invvol-v1` (V3a) | Weights | B0's five names, weighted by the inverse of 63-session daily adjusted-return standard deviation at the signal close. Each weight is capped at 30% with the excess redistributed proportionally (iterated). The total is 100%: no leverage, no cash target |
| `mq-wide10-v1` (V3b) | Breadth | Same top-20 ranking, **10** names at 10% each, at most 3 per sector |
| `mq-fquality-v1` (V4) | Ranking feature | Within B0's momentum top 20, rank by a point-in-time **fundamental** quality score instead of the positive fraction (below), then sector cap and 5 names. Ties and unknown scores are ordered after known scores, by momentum |
| `insider-only-v1` (V5b) | Disclosures only | At each month end, the universe members with at least one qualifying insider purchase (below) in the trailing 90 calendar days. Ranked by distinct purchasers, then aggregate purchase value, then symbol. At most 5 names, 2 per sector, 20% each; the rest is cash. No momentum |
| `mq-insider-tiebreak-v1` (V5c) | Disclosure tie-break | B0, but within the top 20, names with a qualifying insider purchase are ranked first; within each group, B0's order |
| `mq-insider-filter-v1` (V5d) | Disclosure filter | B0's ranking restricted to top-20 names with a qualifying purchase; empty slots stay cash |

**Integrated challenger `mq-buffer-fquality-v1`:** V2's buffer applied to V4's ranking. It is evaluated **only if**
V2 and V4 each have a higher 10 bps continuous Sharpe than B0. If evaluated, it is labelled as a combination of
already-inspected effects, not as confirmation.

## Point-in-time data rules

**Fundamentals (V4)** come from the SEC XBRL `companyfacts` API.
- **Fields used:** each fact's `filed` date, `accn`, `form`, `fp`, period `start`/`end` and unit (USD only).
- **Availability:** a value filed on date D is usable only for a decision at the close of the first exchange session
  **after** D. EDGAR may date filings accepted until 22:00 ET on D, so D's own close is never assumed.
- **Vintage:** at each decision, each period uses the latest value filed before the cut-off. A restatement is new
  evidence on its own filing date and never changes earlier decisions.
- **Score:** the average percentile rank among the scored top-20 names of:
  1. **ROA** = annual `NetIncomeLoss` (fallback `ProfitLoss`), taken from the most recent fiscal-year duration fact
     (330–400 days, `form` 10-K or 10-K/A), divided by `Assets` at that fiscal year end;
  2. **Safety** = 1 − `Liabilities` / `Assets` at the same date (fallback for liabilities: `Assets` −
     `StockholdersEquity`).
- **Stale data:** a fiscal year ending more than 550 days before the decision counts as missing, and the score is
  UNKNOWN.
- **Identity:** issuers are matched by SEC CIK through SEC's `company_tickers.json` (the current mapping). A member
  without a CIK is UNKNOWN; nothing is guessed.
- **Gate:** if fewer than 80% of momentum top-20 names over all decisions have a known score, V4 is reported
  `BLOCKED_BY_POINT_IN_TIME_DATA`, not as a result.

**Form 4 (V5)** comes from SEC's official quarterly *Insider Transactions Data Sets* (Forms 3/4/5 as filed),
2016Q1 onward.
- **Qualifying purchase:** document type `4` or `4/A`, a non-derivative row, `TRANS_CODE = P`, acquired (`A`), shares
  > 0 and price > 0.
- **Ownership:** direct or indirect ownership is recorded. Both count, and indirect ownership is reported separately.
- **Private purchases:** code `P` covers open-market **or private** purchases, and the data sets cannot distinguish
  them. This is reported as `UNKNOWN_VENUE`.
- **Not counted:** `A` grants, `M` exercises, `F` withholding, `G` gifts, `S` sales and every other code.
- **Duplicates:** an amendment is new evidence on its own filing date. Rows identical in owner, transaction date,
  shares and price are counted once.
- **Availability:** a filing dated D is usable at the close of the first session after D, as for fundamentals.
- **Window:** the trailing 90-calendar-day window is counted by filing availability, not transaction date.
- **Gate:** if any quarter file is missing or fails its column contract, V5 is `BLOCKED_BY_POINT_IN_TIME_DATA`.

**13F manager consensus and 13D filings are not tested historically.** Only Berkshire's 13F was collected. The
earlier Berkshire follower failed. Any consensus feature would need a manager universe chosen without hindsight.
These remain forward-only and descriptive.

## Costs, capital and benchmarks

- **Costs:** 0, 5, 10, 25 and 50 bps per side; judged at 10 bps.
- **Realistic friction:** 5 bps per side. At $30,000 these names' orders are far below 0.1% of daily dollar volume,
  so modelled impact is negligible. No commission (Alpaca); cash earns 0%.
- **Capital:** $30,000, plus a $1,000 run at 10 bps. Whole shares only: at $1,000, names above about $195 cannot
  fill a 20% slot. Those failures are reported, not hidden.
- **Benchmarks:**
  - SPY buy-and-hold;
  - the existing frozen weekly strategy;
  - B0;
  - exposure-matched SPY.
- **Exposure-matched SPY, corrected (`matched-v2`):** the overnight return uses the exposure at the prior close; the
  open-to-close return uses the exposure right after that session's opening trades (known at the open). This also
  covers the first session.
  - The original matched benchmark is still reported unchanged.
  - The original used the first session's end-of-day exposure for its whole return, which is a small look-ahead.
    That is an accounting refinement, not a verdict change for earlier results.

## Gates

**The original nine checks** (`analytics/research/evaluate.verdict`) are displayed unchanged for every candidate.

**New-candidate gates.** All must pass at 10 bps on the candidate's judged path: continuous for V2–V5, and the
recovery path for V1.
1. Net Sharpe above SPY buy-and-hold.
2. Net CAGR above exposure-matched SPY (`matched-v2`).
3. Maximum drawdown no worse than −35%.
4. CAGR positive at 10 and 25 bps.
5. Both halves positive (2017–2022, 2023–2026) and at least 6 positive calendar years.
6. No unresolved position at any cost.
7. V1 only: every halt exit loses at most 15% from its halt peak.

**Verdicts:**
- Passing all seven gives `QUALIFIES FOR INDEPENDENT REVIEW` (never activation).
- Otherwise the candidate `FAILS`.
- If none passes: `NONE QUALIFIES`.

## Uncertainty and reporting

- **Uncertainty:**
  - moving-block bootstrap of daily returns (block 21 sessions, 2,000 resamples, seed 20261110);
  - 90% intervals for CAGR and Sharpe;
  - a paired bootstrap of the daily-return Sharpe difference against B0 and against SPY.
  - No significance claim is made for this reused window.
- **Reported for each candidate × cost:**
  - CAGR, total, Sharpe, Sortino, volatility, max drawdown and recovery time;
  - worst month, beta to SPY and market-adjusted (alpha) return;
  - average exposure, time in cash and turnover;
  - costs, calendar years and halves;
  - orders failed/unfilled and unresolved positions.
- **V1 adds:**
  - halts and re-entries;
  - whipsaws (a halt within 60 sessions of a re-entry);
  - sessions in cash;
  - missed recovery, meaning SPY's return while V1 was waiting or cooling down.
- **V5 attribution:**
  - qualifying filings and rows, rows excluded by code, and duplicates;
  - filing lag (filing date − transaction date) and availability lag;
  - how often the feature changed B0's picks;
  - net P&L difference against B0 for the same exposure.

## Forward

- **Qualifying candidates:** a candidate that qualifies for independent review gets its own append-only forward
  ledger, starting at the first month-end after this registration. A forward ledger needs at least 252 sessions
  and 12 rebalances before review (`INSUFFICIENT FORWARD SAMPLE` until then).
- **Other candidates:** no forward ledger. They stay listed as rejected or blocked.
- **No activation:** a forward record never activates anything.
