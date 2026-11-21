# Corporate-action reconciliation: backtest vs live bridge (2026-11-21)

**Research only.** This closes the gap PR #199 found between two treatments of corporate actions:
- **The backtest** scores and marks vendor `all`-adjusted prices.
- **The live bridge** (`stock_weekly_bridge_v2.member_actions`) rebuilds total return from raw prices plus Alpaca
  split and cash-dividend records. It skips a member with any other action, an ambiguous same-day pair, or an
  invalid record in its 253-session window.

Nothing that trades is modified. That includes the backtest engine, both bridges, the planner, the workers,
the caps, model selection, the #195 calibrator and the Nov 23 session. No earlier verdict moves, because this
module only reads the backtest's functions. No action was invented and no price was repaired.

| | |
|---|---|
| Code | `analytics/stock_corporate_actions_recon_v1.py` |
| Tests | `analytics/test_stock_corporate_actions_recon_v1.py`, 22 tests. The fixtures are synthetic and labelled as such; the lock tests read the recorded run. |
| Results | `research/stock_corporate_actions_20261121/reconciliation.json`: derived results only, with record ids and CUSIPs removed. Raw pages are not committed. |
| Run | `stock-weekly-backtest.yml` with `corporate_actions=true` and end 2026-11-19: run 44863429532, code `a42045b` |
| Bars | The same dataset #199 audited (sha256 `28609ff3…`), 2016-01-04 → 2026-11-19, 136 members |
| Records | 67 complete chunks, 0 failed. 5,277 Alpaca records, of which 61 came from former tickers (UTX, FB, MMC and others). Archive sha256 `82e8f753…`. |

Earlier runs are kept on record in the results file:
- 44862437679: HTTP 403, end date too recent for the free SIP plan.
- 44862471424: current tickers only.
- 44862903973: former-ticker records dated *on* the change were still dropped.
- 44863140179: identical counts, before the skip breakdown was added.

## Method

Every rule and tolerance below was fixed in code before the first real record was read. They are listed in
`rules.tolerances`.

1. **Archive.** `/v1/corporate-actions` (the live bridge's endpoint) is fetched through the bridge's own
   read-only `Source`, by calendar year and symbol group.
   - Former tickers are taken from the archive's own `name_changes` records (UTX→RTX, FB→META, MMC→MRSH, …).
   - Each former ticker is requested only up to its change date.
   - A chunk that fails is kept as failed.
2. **Coverage per year.** A year is COVERED only if every chunk completed and the records explain at least 50%
   of the vendor's own dividend ratio steps (a match is within ±3 sessions). Otherwise the year is
   EVIDENCE_MISSING, and every decision whose window touches it is not reconciled. Missing evidence is never
   read as "no action".
3. **Records against the vendor.** Each split and each same-day dividend group is compared with the
   adjusted/raw ratio step at its ex-date: CONSISTENT, VENDOR_NOT_ADJUSTED or MAGNITUDE_MISMATCH. Each
   unsupported action is reported with what the vendor did. Each persistent vendor step (#199's
   `persistent_steps`) that no record explains is STEP_WITHOUT_RECORD.
4. **Decisions.** At every weekly decision, for momentum, steady and the hold-buffer challenger, the
   backtest's picks are compared with live-rule picks.
   - Live-rule picks come from `member_actions` unchanged, with total return built from raw closes plus
     supported records only.
   - Both start from the backtest's holdings, so a difference isolates the data treatment at that decision.
   - If the live bridge would skip a held stock, it rejects the decision (`HELD_SECURITY_SKIPPED`) and is
     counted as frozen.
   - Each difference is attributed either to the skip rule (vendor scores with skipped members removed) or
     to the price treatment.
5. **Returns.**
   - For each held position whose holding week crosses an unresolved event, the day return the backtest
     booked is recorded. The true return through a spin-off or merger stays UNRESOLVED, because the other
     company's price is not in this data.
   - For each week where the picks differ, the gap between backtest picks and live picks is measured at 10%
     per pick on the backtest's own adjusted opens. A week with an unresolved event is excluded and counted.
6. **As-of rule.** Alpaca records carry no publication time. As in the live bridge, an action counts only if
   window start < effective date ≤ last completed session before the decision. Tests prove that a later
   action cannot change a decision.

## Findings

### Evidence coverage

Every year from 2016 to 2026 is COVERED, and every fetch completed.

| Year | Vendor dividend steps | Explained by records |
|---|---|---|
| 2016 | 455 | 453 |
| 2017 | 459 | 459 |
| 2018 | 460 | 458 |
| 2019 | 463 | 462 |
| 2020 | 447 | 447 |
| 2021 | 439 | 439 |
| 2022 | 461 | 461 |
| 2023 | 465 | 465 |
| 2024 | 473 | 473 |
| 2025 | 475 | 474 |
| **2026** | **407** | **381** |

In 2026, **24 of 25 unexplained vendor steps are dividends with ex-dates between Oct 30 and Nov 13.** Alpaca
had not yet published those records when the archive was taken on Nov 21. This matters live: a dividend with no
record is read by the live bridge as a price drop.

### Records against the vendor's adjusted series

There are 5,263 record groups on members.

| Status | Groups | Detail |
|---|---|---|
| CONSISTENT | 5,152 | 5,122 dividend groups, all 28 forward splits and 1 of 2 reverse splits |
| MAGNITUDE_MISMATCH | 5 | Explained below |
| UNSUPPORTED (vendor adjusted) | 18 | |
| UNSUPPORTED (vendor not adjusted) | 84 | Mostly mergers where the member is the acquirer, so no adjustment is due |
| NO_BARS_AT_DATE | 4 | Dividends on the first session of the data |

The five mismatches:
- **COST 2017-05-10:** the vendor shows a 4.2% distribution against a 0.29% dividend record. This looks like a
  missing special-dividend record; it is not verified from another source.
- **T 2022-04-13 and NVDA 2024-06-11:** a spin-off (T, 2022-04-11) or a 10-for-1 split (NVDA, 2024-06-10) falls
  inside the 5-session step window. These are artefacts of the method, and the underlying records exist.
- **AVGO 2016-03-16:** a small difference (0.33% against 0.39%).
- **HON 2026-06-29:** a same-day reverse split and spin-off, listed among the cases below.

**Spin-offs: 14 records, all present in the archive.**
- **12 vendor-adjusted:** GE 2019, EXC 2022, T 2022, GE 2023, DHR 2023, MMM 2024, GE 2024, HON 2025, CMCSA 2026,
  FDX 2026, HON 2026 and SPGI 2026.
- **2 not adjusted, so booked as price drops:** PFE 2020-11-17 (−3.4% that day) and O 2021-11-15 (−2.2%).
- **#199 undercounted spin-offs.** Its ratio classifier labelled only 3 of the 12 adjusted spin-offs
  "unexplained". It counted T, MMM, GE 2024 and FDX as splits (steps of 1.24–1.33 read as 4:3 or 5:4), and
  GE 2019, HON 2025, CMCSA and SPGI as dividends (steps under 10%). Its "30 splits" therefore include
  spin-offs and the RTX consolidation.

### The flagged cases: #199's explanations checked against records

| Case | #199's explanation | What the records show | Verdict |
|---|---|---|---|
| RTX 2020-04-03 | Unadjusted spin-off (Carrier/Otis), −71% | Under the former ticker UTX: a UTX→RTX name change and a **1-for-2 reverse split** (new 0.5, old 1). The vendor's adjusted/raw ratio steps by exactly 0.5, so adjusted −71% = raw −42% compounded with the recorded consolidation. **No Carrier/Otis spin-off record exists** under UTX or RTX. | **Not confirmed as stated.** The −71% comes from a recorded reverse split, not an unadjusted spin-off. Whether that record is right cannot be told from this data; it needs a primary source such as an SEC filing. No strategy held RTX that day. |
| GE 2023-01-03 | Spin-off | Spin-off GEHC on 2023-01-04, ⅓ share; the vendor adjusted (step 1.285). | **Confirmed.** The vendor applied the step one session before the record's ex-date. |
| GE 2024-04-02 | Check it like RTX | Spin-off GEV, ¼ share; the vendor **adjusted** (−2.4% adjusted against −22.2% raw). | **No RTX-like error.** #199 labelled it a split. |
| DHR 2023-10-03 | Spin-off | Spin-off VLTO on 2023-10-02, ⅓ share; the vendor adjusted (step 1.146). | **Confirmed.** Again one session apart. |
| EXC 2022-02-02 | Spin-off | Spin-off CEG, ⅓ share; the vendor adjusted (+4.2% adjusted against −25.9% raw). | **Confirmed.** |
| HON 2026-06-30 | Unexplained falling ratio | On 2026-06-29: a **1-for-2 reverse split and a spin-off HONA (½ share) on the same day**. The combined step is 0.954. | **Explained by records.** The live bridge skips HON: the action is unsupported and the same-day pair is ambiguous. |

### Live-rule vs backtest decisions

All 515 weekly decisions from 2017-01 to 2026-11-16 were reconciled; none lacked evidence.

| Strategy | Picks differ | …because of the skip rule | …because of the price treatment | Live would **reject** the decision |
|---|---|---|---|---|
| momentum | 158 (31%) | 153 | 5 | **242 (47%)** |
| steady | 80 (16%) | 74 (+1 both) | 5 | 83 (16%) |
| hold-buffer challenger | 67 (13%) | 67 | 0 | 199 (39%) |

**The gap is the live bridge's skip rule, not price adjustment.** The skips break down as follows:
- **3,374 of the 4,174 member-decision skips (81%) come from merger records.** In 80 of the 107 unsupported
  records touching members, **the member is the acquirer** (cash mergers 43, stock mergers 33, stock-and-cash
  mergers 4). Examples are MS (2020-10-02 and 2021-03-01) and PFE (2022-03-11). An acquirer's holders keep their shares
  unchanged, yet the bridge skips the stock for 253 sessions.
- 612 skips come from spin-offs, 188 from name changes, and 484 from ambiguous same-day dividend pairs (FCX,
  GE and others).
- If a held stock is affected, the live bridge **rejects the whole weekly decision**. For momentum that would
  have happened in nearly half of all weeks.

### Returns

- **One-week gap between backtest picks and live-rule picks**, on the backtest's own prices at 10% per pick
  (positive means the backtest picks did better):

  | Strategy | Sum of weekly gaps | Weeks measured | Better weeks (backtest / live) | Weeks excluded |
  |---|---|---|---|---|
  | momentum | −4.4 points | 157 | 81 / 76 | 1 |
  | steady | +1.7 points | 79 | 38 / 41 | 1 |
  | hold-buffer challenger | −4.3 points | 67 | 31 / 36 | 0 |

  Means are below 0.07 points a week, with no consistent sign. **The pick differences do not systematically
  favour either treatment.** Frozen weeks (no rebalance) are not valued here.
- **Unresolved events inside held weeks:** momentum 5, steady 3, challenger 3. The booked effect at target
  weight sums to +0.52, +0.09 and +0.27 points of portfolio return respectively.
  - The largest is **momentum holding GE through the GEV spin-off on 2024-04-02**: −2.4% booked
    (vendor-adjusted) against −22.2% raw. The true return depends on GEV's value and is UNRESOLVED.
  - No strategy held RTX on 2020-04-03.
- **No earlier backtest verdict is affected.** The booked effects are fractions of a point. #199's
  RTX worry never entered a portfolio, and its direction finding (biases favour stock selection over SPY) is
  unchanged.

## Remaining evidence limits

1. **Coverage is not attested.** Alpaca's coverage is shown empirically (≥ 93.6% of vendor dividend steps per
   year), not attested by the provider. Records for the most recent three weeks were not yet published.
2. **No publication times.** The as-of rule uses effective dates. That an action was known before a decision is
   not verified.
3. **Value through spin-offs and mergers is unresolved.** It needs the spun-off company's prices or the cash
   terms, which are not in the bars file.
4. **Some records cannot be verified here:** the RTX reverse-split record and the COST special dividend need a
   primary source, such as an SEC 8-K.
5. **The step window can merge two events within 5 sessions** (T, NVDA). Those are reported, not reclassified.
6. **Inherited from #199:** survivorship and current sector labels.

## For Codex (operational decisions; nothing here changes them)

1. **The skip rule rejects many weekly decisions.**
   - The live v2 bridge rejects a whole weekly decision whenever a held stock touched any unsupported action
     within a year, and most of those actions are mergers where the stock was the acquirer.
   - Decide whether acquirer-side `cash_mergers`, `stock_mergers` and `stock_and_cash_mergers` (`acquirer_symbol`
     is the member) and pure `name_changes` should still skip.
   - The data for that decision is `decisions.*.live_skip_kinds` and `records.unsupported_member_roles`.
2. **Archive the action pages the live bridge already fetches** (#199 item 3). With them, this reconciliation can
   check live decisions against the same records.
3. **Recent dividends without records:**
   - Ex-dates in the last two to three weeks have no records yet, so the live bridge books those dividends as
     price drops.
   - The effect is small but systematic.
   - The fix needs an operational choice: re-capture later, or tolerate it.
4. **To re-run:** dispatch `stock-weekly-backtest.yml` with `corporate_actions=true` and `end` set to the last
   completed session (an end date too close to now returns 403 on the free plan). The reconciliation prints
   `RECON_JSON` to the log.
