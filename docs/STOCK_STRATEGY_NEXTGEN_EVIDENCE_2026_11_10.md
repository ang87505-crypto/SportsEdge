# Evidence memo and repository audit: next-generation stock research (2026-11-10)

Research only. Published historical results are kept separate from evidence of an advantage that can be
implemented **today**. None of this is a promise of returns.

## 1. Evidence matrix

| Approach | Published historical evidence | Evidence of an implementable edge today | This project's own result |
|---|---|---|---|
| **SPY buy-and-hold** (benchmark) | Broad index funds beat most active funds over long horizons. S&P's SPIVA scorecards repeatedly show a large majority of US large-cap active funds trailing the S&P 500 over 10+ years | Strong: low cost, no selection or timing risk, dividends reinvested | 14.5% CAGR, Sharpe 0.84, max DD −33.8% (2017-02 to 2026-11). **The bar every candidate must clear** |
| **Intermediate-term momentum** (12-1 month, monthly) | Jegadeesh & Titman (1993): past 3–12-month winners kept outperforming over the next 3–12 months. Risks: Daniel & Moskowitz (2016) show sharp *momentum crashes* after market rebounds (e.g. 2009). McLean & Pontiff (2016): published anomalies earn materially less after publication | Moderate and weakening. Long-only, large-cap, low-turnover versions keep only part of the long–short premium, and costs plus crashes eat into it | B0 continuous: 16.4% CAGR but −35.1% max DD and Sharpe 0.73, below SPY's 0.84. **Higher return, worse risk-adjusted** |
| **Business quality** (profitability, safety, conservative investment) | Novy-Marx (2013, gross profitability); Asness, Frazzini & Pedersen, *Quality Minus Junk*: high-quality firms earn higher risk-adjusted returns. Frazzini, Kabiller & Pedersen, *Buffett's Alpha*: much of Berkshire's record is explained by cheap, safe, high-quality stocks plus leverage | Plausible as a *ranking within* a momentum set. It needs **as-filed** accounting with filing dates; restated databases leak the future | Not tested before. **B0's "quality" is the share of positive days, a price-consistency feature, not accounting quality.** V4 tests real accounting quality from SEC filings |
| **Cost-aware turnover** (rank buffers, bands) | Standard implementation research: buffers cut turnover with small signal loss | Strong for *costs*, weak for *alpha*: it cannot create returns, only keep more of them | PR #97 (exploratory, older engine): turnover about −60%. That variant earned less than plain momentum at 10 bps and more at 25/50 bps |
| **Volatility management / risk weights** | Moreira & Muir (2017): volatility-managed factors had higher Sharpe in-sample. Cederburg, O'Doherty, Wang & Yan (2020, *JFE*): out of sample most volatility-managed strategies **did not** beat their unmanaged versions | Weak to moderate. It mainly reduces drawdown, and that comes with lower return | PR #97: volatility-adjusted ranking traded return for a smaller drawdown |
| **Day trading, short-horizon reversal/momentum** | Barber, Lee, Liu & Odean (2014): in Taiwan, only a tiny fraction of day traders predictably profit after fees | **Disfavoured.** Spreads, impact and fees are paid every day; small edges are fragile | PR #123: daily reversal −12.0%/yr and five-day momentum −9.0%/yr after costs. Rejected; **not re-fished here** |
| **Delayed 13F manager following** | 13F shows quarter-end long holdings, filed **up to 45 days after the quarter**. No trade dates, no shorts, no intra-quarter trades | Weak: the information is stale by construction, and picking "great managers" after the fact is hindsight bias | Berkshire top-5 follower: 11.3% CAGR, −42.0% DD, Sharpe 0.63. **Worse than SPY** |
| **Form 4 insider purchases** | Lakonishok & Lee (2001): insider purchases carried information, mostly in smaller firms. Cohen, Malloy & Pomorski (2012): "opportunistic" (non-routine) insider trades predict returns, routine ones do not | Possible but small for large caps. Form 4 is due **within two business days**, so the public learns after the trade. Code `P` includes **private** purchases | V5 tests it as an *add-on* to unchanged momentum and standalone, using official SEC data |
| **13D activist filings** | Initial filing due within 5 business days of crossing 5% (SEC 2023 amendments) | Event-driven, often takeover context; very sparse in mega-caps | Not tested; forward-only |
| **Fund daily holdings** (e.g. QMOM) | Shows holdings as of a date, not fills | Forward-only (no historical snapshots) | Forward ledger running since 2026-11-10 |

## 2. Why medium-term momentum is the lead hypothesis, and why that is still only a hypothesis

- **Momentum:**
  - It is one of the most replicated return patterns, it trades monthly, and its costs at this account size are small.
  - On this project's data it beat SPY's **CAGR** but not its **Sharpe**, and its drawdown (−35%) breaks the risk
    limit.
  - The open questions are risk and concentration, not raw return. That is why V1 (recovery), V2 (turnover) and V3
    (diversification) each change exactly one thing.
- **Day trading** has already lost after costs here. Repeating it with new parameters would be fishing.
- **Insider and Form 4 signals** might add value only as a **feature** tested against the same base strategy. If
  stocks rose *before* the filing became public, a follower cannot capture that rise.
- **13F cannot copy trades in time:**
  - it shows positions up to 45 days after the quarter ends;
  - it does not show when trades happened;
  - it omits shorts and most non-equity positions.
- **What historical simulations cannot show:**
  - **Reused window:** 2017–2026 has already been inspected.
  - **Survivorship:** the 136-name universe is today's large caps, which inflates momentum-style results.
  - **No fresh confirmation:** good backtest numbers here are not new evidence.
  - **Real confirmation** can only come from forward data, which takes about a year (12 monthly rebalances) to mean
    anything.

## 3. Repository audit (2026-11-10, main at `cd2eec4`)

**PR status:**

| PR | State | Relevance |
|---|---|---|
| #97 cost-aware momentum | **Open** (not merged) | Prior exploratory buffer/volatility evidence on an older cash-constrained replay. Used as context only, not merged or ported |
| #111 research system | Merged | Engine, candidates, nine checks, B0 results (reproduced from `research-data` `results/historical-2026-11-09T223926Z.json`, dataset `db7b70db76fb0f2f`) |
| #123 daily study | Merged | Negative result, kept; nothing here re-tests daily trading |
| #129 scheduler backup | Merged | Untouched |
| #130 commissioning proposal | **Open, draft** | Unrelated to research. Untouched; nothing here depends on it |

**Accounting and lineage findings:**
1. **Exposure-matched SPY, first session.** The original matched benchmark applies the first session's
   *end-of-day* exposure to that session's whole return. It also applies each prior close's exposure across
   rebalance opens. This is a small look-ahead/lag mismatch.
   - **Fix:** a corrected `matched-v2` lags overnight returns by the prior close and intraday returns by the
     exposure right after the opening trades.
   - **Proof:** a regression test reproduces the old convention's same-bar exposure: a candidate half invested at
     the first open whose stock doubles intraday is credited 2/3 of SPY's first-day move instead of 1/2
     (`test_original_matched_benchmark_uses_same_bar_exposure_on_the_first_session`). The corrected version passes
     `test_matched_v2_uses_only_exposure_known_before_each_bar`.
   - **Scope:** the original benchmark and all published verdicts are kept unchanged. `matched-v2` is used only for
     the new gates.
2. **Halt semantics.** The as-live path halts at −10% and never resumes, because a replay cannot simulate the owner.
   Its low CAGR (3.4%) mostly reflects years in cash after a February 2018 halt. Turning the halt off is **not** a
   fix: the continuous path has a −35% drawdown. V1 is a separately labelled research proposal. The production stop
   stays owner-only.
3. **Path sensitivity.** The as-live halt date already varies with cost level (2018-02-08 at 10 bps, 2018-10-10 at
   0 and 25 bps). A 10% stop is close to the strategy's normal fluctuation, so one bad week decides a decade.
4. **Ticker reuse and renames.** META/METV and MMC/MRSH are covered by the existing entity checks and tests. Fundamentals and Form 4 rows are joined by SEC CIK, not
   ticker, and the filed symbol is kept for audit.
5. **Survivorship.** No point-in-time membership is available. The current list is labelled survivorship-biased
   and no current ETF holdings are substituted.
6. **Whole shares at $1,000.** Many members trade above about $195, so a 20% slot at $1,000 often cannot hold
   one share. The $1,000 runs report these unfilled orders instead of hiding them.

**Risk controls that this work does not and cannot change:**
- Owner Start/Stop/Pause;
- `brokerWritesEnabled` (OFF on main), `scheduledRunsEnabled`, `realMoneyEnabled` (OFF);
- the production drawdown stop and owner-only resume;
- release watcher pins;
- Vercel and GitHub schedules;
- the frozen weekly autopilot and its registration;
- the frozen November 10 daily shadow experiment.

## References

- Jegadeesh & Titman (1993), *Journal of Finance*, doi:10.1111/j.1540-6261.1993.tb04702.x
- Daniel & Moskowitz (2016), "Momentum crashes", *Journal of Financial Economics* 122(2)
- McLean & Pontiff (2016), *Journal of Finance*, "Does academic research destroy stock return predictability?"
- Novy-Marx (2013), "The other side of value: the gross profitability premium", *JFE* 108(1)
- Asness, Frazzini & Pedersen (2019), "Quality minus junk", *Review of Accounting Studies* 24
- Frazzini, Kabiller & Pedersen (2018), "Buffett's Alpha", *Financial Analysts Journal* 74(4)
- Moreira & Muir (2017), "Volatility-managed portfolios", *Journal of Finance* (NBER w22208)
- Cederburg, O'Doherty, Wang & Yan (2020), "On the performance of volatility-managed portfolios", *JFE* 138(1)
- Barber, Lee, Liu & Odean (2014), "The cross-section of speculator skill: evidence from day trading", *Journal of
  Financial Markets* 18
- Lakonishok & Lee (2001), "Are insider trades informative?", *Review of Financial Studies* 14(1)
- Cohen, Malloy & Pomorski (2012), "Decoding inside information", *Journal of Finance* 67(3)
- S&P Dow Jones Indices, SPIVA U.S. Scorecards
- SEC:
  - Form 13F FAQ (45-day deadline);
  - Form 4 timing (two business days);
  - ownership form transaction codes;
  - 2023 Schedule 13D/G amendments (five business days);
  - EDGAR APIs and Insider Transactions Data Sets.
- Also listed in the brief and not independently reviewed here: the 2020 *Journal of Corporate Finance* insider
  study and the SSRN 13F copycat paper. No claim in this memo relies on them.
