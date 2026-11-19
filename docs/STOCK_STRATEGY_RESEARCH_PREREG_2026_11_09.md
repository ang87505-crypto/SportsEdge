# Stock strategy research: pre-registration (2026-11-09)

Committed **before any candidate evaluation on real data**. Nothing below changes after results are
seen; a different rule is a new, separately registered variant, and every tested variant is recorded in
`config/research/registry.json`, including failures. Research only: no candidate is active, broker
writes and activation stay off, and paper results alone never enable real money.

Source brief: *SportsEdge: research from verified investors and public strategies* (2026-11-09).
Shortlisting these managers used hindsight about their success; historical tests therefore carry
manager-selection bias and are not an untouched test of a rule that would have chosen them in advance.
The daily open-to-close study (PR #109, NONE QUALIFIES) stays a permanent negative result.

## Common rules

**Account and costs**
- $30,000 virtual capital and 0% interest on cash.
- Costs are slippage per side on traded notional, at 0 bps (gross) and 5, 10 and 25 bps.

**Data**
- Alpaca SIP daily bars, raw and split/dividend-adjusted, `asof` the window's end date. A symbol with no bars as of the end date is refetched as of the date it was first needed.
- Alpaca `/v1/corporate-actions`.
- No other price source and no paid plan.

**Execution** (`analytics/research/engine.py`)
- **Timing:** a decision made at session *k*'s close executes at session *k+1*'s open.
- **Sizing:**
  - equity = cash + holdings at *k*'s raw closes;
  - desired shares = floor(w · equity ÷ (close · 1.0025));
  - a continuing holding is resized only if the change exceeds 20% of its target value.
- **Sells:** done first, market-on-open at the raw open. A sell with no bar stays pending, is marked unresolved, and retries each session.
- **Buys:**
  - limit-on-open at round(close_k · 1.03, 2), in the candidate's order;
  - filled at the raw open if it is at or below the limit, otherwise left unfilled as cash, with no chasing;
  - cut to the whole shares that cash can pay for, never borrowed.
- **Corporate actions,** applied on their effective session before the open:
  - cash dividends credited on the ex-date (the pay date is ignored);
  - splits and stock dividends change share counts, with fractions paid in cash at that session's raw open;
  - cash mergers and redemptions convert to cash;
  - stock mergers, spin-offs and name changes carry into the new symbol when it has prices.
- **Unresolved positions:** an unsupported action, or a position missing bars for more than 5 sessions, is unresolved. **Unresolved positions block every new buy** and are counted at every cost level and in both series.
- **Integrity check:** a raw-versus-adjusted daily return gap above 2% with no action is reported. Above 25%, the position is marked unresolved.
- **Ticker changes** among requested symbols: bars are joined at the change date, with old adjusted prices rescaled so the adjusted return across the join equals the raw return.

**Halt** (the as-live series)
- The peak starts at $30,000. A close at or below 90% of the peak halts.
- **Existing holdings after a halt:** all are sold at the next available regular-session open. A gap can make the realized loss larger than 10%.
- Nothing is bought again until an explicit owner authorization; a replay has none.
- The **continuous** series runs identical rules without the halt.

**Metrics**
- Daily closes; CAGR on 252 sessions a year; Sharpe = mean ÷ s.d. of daily returns × √252 (0% rate); maximum drawdown on closes.
- Turnover per year = traded notional ÷ average equity ÷ years.
- Exposure = invested ÷ equity at each close.
- Also reported: total return, end cash, costs paid, dividends, calendar-year returns, order counts (filled, unfilled by gap, no bar or cash; reduced for cash; unavailable targets; blocked by unresolved), unresolved positions and integrity mismatches.

**Comparisons over identical dates**
- SPY buy-and-hold with distributions: adjusted open of the first session to adjusted closes.
- **Exposure-matched SPY:** SPY's total return scaled each session by the candidate's invested share at the previous close (continuous, 10 bps), the rest in cash.
- The live weekly strategy, replayed by `analytics/stock_weekly_backtest_v1.replay` (its own $1,000 account, about half invested), at each cost.
- BRK.B and QMOM buy-and-hold with distributions (market prices). Fund expenses are already inside QMOM's price and are not deducted again.

## Candidate 1: `momentum-quality-paper-v1` (public-method adaptation, not a QMOM replica)

**Signal and eligibility**
- **Signal sessions:** the last session of each calendar month, *T*, after the close.
- **Universe:** `config/paper-auto/universe-large-cap-v1.json` as on `main` at registration (revision `large-cap-v1-2026-10-30`, 136 members, survivorship-biased), with sectors from the file.
- **Eligible members need:**
  - all adjusted closes T−252..T present and positive;
  - a raw close at T of at least $5;
  - average raw close × volume over T−19..T (20 sessions) of at least $20,000,000;
  - momentum = adjusted close(T−21) ÷ adjusted close(T−252) − 1, greater than 0.

**Selection and sizing**
- **Top 20** eligible members by momentum (ties: symbol).
- **Quality:** the fraction of strictly positive daily total returns ac_i ÷ ac_{i−1} − 1 for i = T−251..T−21 (231 returns). Zero-return days stay in the denominator.
- **Ranking:** the top 20 are ranked by that fraction (descending), then momentum (descending), then symbol.
- **Picks:** walk the ranking taking up to 5 names, at most 2 per sector.
- **Sizing:** target 20% each. Names leaving the target are sold. Unused allocation and whole-share residuals stay cash.

**Windows**
- **Historical (exploratory):** first signal 2017-01-31, first execution 2017-02-01, last session 2026-11-06.
- **Forward:** first signal on the first month end on or after 2026-11-10 (2026-11-30).

## Candidate 2: `qmom-disclosure-follower-v1` (actual disclosed holdings)

**Collection**
- **Source:** the official page `https://funds.alphaarchitect.com/qmom/` (holdings Effective Date and table), plus the site's own table endpoint if the table is served page by page. Robots.txt allows it, at one request per 10 seconds.
- **Stored per snapshot:** the complete raw page, SHA-256, URL, retrieval time and effective date.
- **Usable snapshots:**
  - status OK only: at least 20 rows, weights summing to 90–102%, no duplicates;
  - effective date at most 3 business days old and not in the future.
  - INCOMPLETE, STALE and PARSE_FAILED snapshots are stored but never used.

**Trading**
- **Initialization:** at the first session strictly after the New York date of the first OK snapshot's receipt, using what was received before that session's open.
- **Rebalances:**
  - on the first session of each later calendar month;
  - using the latest OK snapshot received before the previous session's 16:00 New York close.
- **Targets:**
  - each disclosed weight, capped at 20%;
  - a holding without a price at the signal close stays cash;
  - excluded weight is reported and never redistributed.
- **Forward only:** historical snapshots do not exist and are never reconstructed from today's holdings.

**Reported tracking:** against QMOM over identical dates, with the reasons for differences (disclosure delay, share rounding, missing assets, costs).

## Candidate 3: `berkshire-13f-top5-paper-v1` (delayed filing follower; an adaptation)

**Source and timing**
- **Source:** SEC EDGAR only, CIK 0001067983:
  - the submissions index and its older pages;
  - each 13F-HR and 13F-HR/A's `index.json`, `primary_doc.xml` and information table.
- **Stored per document:** accession, form, report period, acceptance time (UTC), retrieval time, raw document and SHA-256. Requests declare the User-Agent from the `SEC_EDGAR_USER_AGENT` secret.
- **Availability:** a filing is known from its EDGAR acceptance time, never from the quarter end. Each filing event executes at the first session strictly after its acceptance date in New York.

**Holdings as known**
- At any time, holdings come from the latest reporting period with an original 13F-HR already accepted.
- A RESTATEMENT amendment replaces that period's holdings from its own acceptance.
- NEW HOLDINGS amendments add to them from their own acceptance.
- A later amendment is never treated as known earlier.

**Eligibility and selection**
- **Eligible:** share positions (`SH`), no put or call, and a title of class not matching preferred, notes, debt, warrants, rights, units, ADR/ADS, convertible, option, ETF or fund. Duplicate lines (one per manager) are summed by CUSIP. Positions are ranked by reported value.
- **Mapping:** the top 15 eligible CUSIPs per filing are mapped to US tickers with the free OpenFIGI API (US composite equity listing; ambiguous results are left unmapped). Every response is stored.
- **Selection:** the first 5 mapped holdings with a price at the signal close, 20% each. Unmapped or unpriced holdings are skipped and listed, and the slot stays cash.

**Rebalances and windows**
- **Rebalances:** on every filing or amendment event. An event that leaves the target unchanged trades only outside the 20% band.
- **Historical:** the initial portfolio is what was public by the 2017-01-31 close, executed 2017-02-01; the window runs to 2026-11-06.
- **Forward:** initial execution on 2026-11-10 from filings public by the previous close.

## Pass/fail (historical candidates 1 and 3)

Conditions use the **continuous** series at **10 bps** unless stated. A candidate **QUALIFIES FOR REVIEW**
only if all nine hold; otherwise it FAILS. If none qualifies, the result is **NONE QUALIFIES**, and the
least bad candidate is never activated or proposed.

1. Net CAGR > 0 at 10 bps and at 25 bps.
2. Sharpe > SPY buy-and-hold Sharpe.
3. Net CAGR > exposure-matched SPY CAGR.
4. Sharpe > the weekly strategy's Sharpe at 10 bps.
5. Maximum drawdown no worse than −35%.
6. Net CAGR > 0 in both 2017-02-01..2022-12-31 and 2023-01-01..2026-11-06 (descriptive halves, neither untouched).
7. Positive returns in at least 6 of the calendar years 2017–2026 (2017 and 2026 partial).
8. Zero unresolved positions and none open at the end, at **every** cost level (0, 5, 10, 25 bps), in both the as-live and continuous series.
9. As-live at 10 bps: if the halt triggers, equity after the halt exit is no worse than −15% from the halt peak (opening gaps included).

Qualifying for review only permits a reviewed proposal. It never activates trading.

## Forward evaluation (all three)

- **Ledgers:** each candidate keeps its own forward paper ledger from 2026-11-10, recomputed nightly from stored snapshots and fresh bars. Every run is stored append-only.
- **Sample status:** a ledger reports **INSUFFICIENT FORWARD SAMPLE** until it has at least 252 sessions and 12 executed rebalances (6 for the 13F follower, which rebalances about quarterly).
- **Review:** only then are conditions 1–3 and 8 applied to the forward ledger, plus, for the QMOM follower, an annualized tracking difference against QMOM within ±3 percentage points.
- **Time alone proves nothing:** six months, or any elapsed time on its own, is a review point, not proof of an edge.

## Reproducibility

Every result file records:
- the dataset SHA-256 (sessions, bars, actions), the corporate-action pages' SHA-256, joins and refetches;
- the SEC accessions and acceptance times used, and the CUSIP mapping;
- the registry SHA-256, every rule and code file's SHA-256 (`registry.fingerprints`), and the code commit.

Results, snapshots and reports are written append-only to the `research-data` branch.
