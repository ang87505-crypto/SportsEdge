# Stock data quality and historical accuracy audit (2026-11-20)

**Research only.** Nothing here changes the live paper strategy, allocation limits, bankroll, broker controls, the
Nov 23 supervised session, or any collector or provider access. No order was sent and no model was activated.

The audit checks the exact bars file every stock backtest uses, the universe file, the SEC point-in-time pipeline, and
the replay code. Findings are reported, never patched: no historical membership, price or fundamental was manufactured.

## How it was run

| Item | Value |
|---|---|
| Code | `analytics/stock_data_audit_v1.py` (bars, corporate actions, universe, leakage); `src/lib/research/sec-pit-v2.ts` (SEC) |
| Run | [44852266554](https://github.com/ang87505-crypto/SportsEdge/actions/runs/44852266554): the manual read-only `stock-weekly-backtest.yml` on `3298ea9`, with a new no-network audit step after the existing fetch |
| Data | Alpaca SIP daily bars, raw and all-adjusted, 2016-01-04 → 2026-11-19 (2,737 sessions), 135 members plus SPY. Dataset digest `28609ff3…0948`. |
| Output | `research/stock_data_quality_20261120/audit.json` and `forward.json` (the run's printed JSON) |
| Superseded runs (kept on record) | 44831451111: the fetch got HTTP 403 because an end date of today requests bars in the most recent window, which the free data plan restricts; the audit step correctly skipped. 44831533366: its corporate-action counts were rounding noise (see below). 44852035462: the split list stopped at 20:1. Their coverage, universe and leakage results are identical to the final run. |

## Priority 1: findings

### 1. Price and bar integrity: clean

| Check | Result |
|---|---|
| Symbols with data | 136 of 136 (135 members plus SPY); none missing |
| Gaps inside each symbol's traded range | **0** |
| Missing or non-positive prices | **0** |
| Members starting after the data start, or ending before its end | none: every member is a survivor that traded throughout |

### 2. Look-ahead in the backtest signal: none found in the replay code

- **Truncation test:** for 24 decisions spread across 2017-01-09 → 2026-04-13, the momentum picks were recomputed from a
  series with **everything after the decision session's open deleted**. **0 of 24 differed.**
- **Code review agrees:**
  - momentum, trend, volatility, the $5 floor, the $20M dollar-volume floor and the $95 cap all use sessions
    strictly before the decision (`score()` reads `k−253 … k−1`);
  - trades happen at session k's open;
  - dollar volume uses raw close × raw volume, which is correct point in time across splits;
  - back-adjusted price ratios between two dates are unaffected by corporate actions after both dates.
- **One minor same-day dependency:** a member must have an opening bar on the decision session to be eligible. A stock
  halted at the open is therefore excluded using that morning's information. At an 08:00 ET decision this is mildly
  optimistic, and it affects only halts.

**The look-ahead that does exist is in the inputs, not the code** (sections 4 and 5).

### 3. Corporate actions: mostly handled; two material gaps

| Inferred from the adjusted/raw ratio | Count |
|---|---:|
| Split-like steps (including CMG 50:1 in 2024 and BKNG 25:1 in 2026) | 30 |
| Dividend-like steps (≥ 10 bps; smaller dividends are not counted individually) | 5,045 |
| **Unexplained steps** | **4** |

- **Method.** Vendor adjusted prices are rounded, so the ratio jitters by up to about 0.05% a day. Events are therefore
  persistent steps: the median of the next 5 ratios against the previous 5. The first audit run counted that jitter and
  is superseded.
- **Unexplained steps, which line up with known corporate events:**
  - DHR 2023-10-03 (×1.146; Veralto spin-off);
  - EXC 2022-02-02 (×1.405; Constellation spin-off);
  - GE 2023-01-03 (×1.285; GE HealthCare spin-off);
  - HON 2026-06-30 (×0.954). The ratio *fell*, which is never a normal adjustment; review against the vendor's
    corporate-action feed.

**Gap A: backtest and live use different corporate-action treatment.**
- The backtest uses the vendor's `all`-adjusted series, which includes spin-off adjustments such as DHR, EXC and GE above.
- The live weekly bridge (`stock_weekly_bridge_v2.py`) rebuilds prices from raw bars plus Alpaca actions. It accepts
  only splits and cash dividends, and **skips any member with an unsupported action** in its window.
- So in weeks around a spin-off, the backtest can hold or select a name that the live rules would have skipped.
- Quantifying this needs the historical corporate-action feed. That is an existing, permitted, read-only Alpaca endpoint,
  but it is not archived for history today.

**Gap B: an apparently unadjusted spin-off.**
- RTX shows a **−71% one-day adjusted return on 2020-04-03**, the day UTC (renamed RTX) distributed Carrier and Otis and
  completed the Raytheon merger.
- The adjusted series has no compensating step, so a backtest holding it then would book a fictitious 71% loss. Not
  verified against the vendor's action feed.
- GE Vernova (spun off 2024-04-02) shows neither a ratio step nor a move above 25%. Whether that spin-off is adjusted
  should be checked the same way.
- The other moves above 25% look like genuine market moves (March 2020, earnings gaps); they are listed in `audit.json`.

**Ticker changes.** The fetch uses `asof=<end>`, so renamed survivors are pulled under today's symbol (FB→META,
MMC→MRSH). Companies that disappeared are absent (section 4).

### 4. Survivorship bias: structural; cannot be fixed with permitted data

- **What the universe is.** `universe-large-cap-v1` is 135 companies chosen in 2026. All carry the same
  `first_traded_on` 2015-01-02, a declared lower bound, not a listing or membership date.
- **What is missing.** No company that was large in 2017–2025 but was later acquired, delisted, went bankrupt or shrank
  appears in any week. One example in the universe's own notes: EA was removed after its 2026-08 cash merger.
- **Effect.** Every stock-selection backtest is biased upward. SPY is not, being a point-in-time index fund, so "below
  SPY at matched exposure" findings are conservative.
- **What is possible with permitted sources (partial):**
  - SEC EDGAR filings index: Form 25 (delisting) and 15-12B (deregistration), public and free;
  - SEC company facts (`dei:EntityCommonStockSharesOutstanding`) can identify *candidates* that were once large.
  - Neither gives index membership, and prices for delisted names would still be needed.
- **What is required:** licensed point-in-time constituents with add/remove dates (for example CRSP, S&P, Norgate), plus
  delisted-security prices. This is a **paid licence and an owner decision** (already listed in `src/lib/research/sources.ts`
  as `survivorship-free-constituents`, status `proposed`).

### 5. Sector classification is current, not point in time

- **What the labels are.** Sector labels are maintainer assignments as of 2026, applied to every historical week.
- **Two GICS changes inside the backtest window affect current members:**
  - **2018-09:** Communication Services was created. GOOGL and META moved from Information Technology; NFLX, DIS, CMCSA
    and CHTR moved from Consumer Discretionary; T, VZ and TMUS came from the renamed Telecommunication Services sector.
  - **2023-03:** V and MA moved from Information Technology to Financials.
- **Effect.** The 2-per-sector cap therefore used later classifications in earlier weeks. That is minor look-ahead in a
  portfolio constraint, not in the signal.
- **Fix.** Point-in-time GICS history is licensed data. The SEC's SIC codes are free but current-only, so they do not fix
  this.

### 6. Fundamentals: none are used today; the SEC pipeline needs v2 before they are

The momentum and hold-rank backtests use no fundamentals, so there is no fundamental look-ahead in any recorded result.
For future quality or value research, the existing SEC pipeline has three defects:

| Defect in the existing v1 pipeline | Evidence | v2 (`sec-pit-v2.ts`, tested) |
|---|---|---|
| **Duration-blind values.** The parser drops each fact's `start`. A 10-Q reports the 3-month quarter and the year-to-date value with the same end date, so `asOf` can return 3-, 6-, 9- or 12-month figures for the same tag. | Synthetic 10-Q fixture: v1 cannot tell Q3 revenue 130 from 9-month 360 | Keeps `start`; classifies instant / quarter / annual / other; `asOfKind` returns one kind only; `durationAmbiguity` measures how often v1 was ambiguous |
| **"Restatements" overcounted.** The intake's `periodsWithMultipleFilings` (224–445 per company in the 2026-11-20 run; 11 for XOM) groups by tag+end only, so it counts QTD/YTD pairs and repeated comparative columns. | `collect.ts` `qualityReport` | `restatementReport` separates repeated identical values from true restatements (a later filing changed the value) |
| **Ticker→CIK uses today's map.** The intake mapped **XOM → CIK 0002115436 with only 32 facts**, against 940–1,508 for the other nine large caps checked. A current mapping can point at a registrant whose history sits under another CIK. Not verified further here. | `research-intake/runs/44652136225-1/report.json` on `research-data` | `identityCheck` flags `HISTORY_STARTS_AFTER_WINDOW` / `FEW_FACTS`. It never back-fills from another CIK by guesswork. |

**What works.**
- **Availability timing:** each fact's `filed` date is the right availability time, and both v1 and v2 use only facts
  filed strictly before the decision day.
- **Validation:** the intake's validation found 0 as-of leaks.

**What blocks real-data verification of v2.** The intake archives reports, not raw company-facts bodies, so v2 has not
been run on real filings in this PR. Running it needs the existing approved intake to also call the v2 audits, a small
change to an approved collector that belongs to Codex.

**Not addressed by any free source:**
- point-in-time fundamentals for companies that no longer file (survivorship again);
- XBRL data before about 2009-2011, depending on filer size.

## What can be fixed with permitted data, and what needs a licence

| Deficiency | Permitted fix (existing access) | Needs licence or owner approval |
|---|---|---|
| Corporate-action mismatch, backtest vs live | Archive the Alpaca corporate-action feed (read-only, existing key). Replay the live bridge's skip rule in the backtest. Measure affected weeks. | — |
| Unadjusted spin-offs (RTX 2020; check GEV 2024) | Same feed: cross-check every one-day move above 25% against recorded actions | — |
| Point-in-time fundamentals | SEC company facts with v2 duration-aware parsing (free, already collected for 10 tickers) | Coverage of delisted filers is partial |
| Ticker/CIK history | SEC submissions JSON (former names, CIK history) to verify mappings | — |
| Survivorship-free universe | Partial: SEC Form 25/15 lists candidates only | **Licensed historical constituents and delisted prices (paid; owner decision)** |
| Point-in-time sectors | — | **Licensed GICS history** |

## What the audit does not change

All earlier verdicts and negative results stand:
- momentum below SPY at matched exposure;
- holdrank10 `BEATS_CURRENT_BELOW_MATCHED_SPY`, forward only;
- cashaware `FAILS`;
- idle-cash `NO_NEW_CHALLENGER`;
- core-satellite RUNNING;
- risk-adjusted momentum REJECTED.

Their biases are documented above. Every bias found inflates stock selection relative to SPY, so none of these negative
findings would reverse if corrected.
