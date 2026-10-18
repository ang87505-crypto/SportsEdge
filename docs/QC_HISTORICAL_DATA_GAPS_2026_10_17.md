# QuantConnect historical-data gaps for the frozen 2000–2011 stock study

**Research infrastructure only.** No historical source is admitted. No strategy
backtest ran and no performance was measured. No QuantConnect data was read,
exported or summarised for this report. Every fixture is synthetic.

This branch is stacked on PR #78 (`5dd6439`), which is stacked on PR #53. It adds
files and changes none of their files, none of Astra's frozen strategy files,
and no paper-trading automation.

The machine-readable version of this report is
`research/qc_historical_gaps_20261017/capability_matrix.json`. A test keeps it
tied to every review gate in `stock_development_runner_v1.REVIEWS` and
`source_bridge.REQUIRED_REVIEWS`.

## 1. Can QuantConnect supply the full NYSE/NASDAQ/AMEX common-stock universe, including delisted stocks?

**Partly. It is not established as complete.**

- **Prices.** AlgoSeek US Equities covers about 27,500 securities from January
  1998 and is built from the full SIP CTA/UTP feed. QC describes it as
  survivorship-bias-free. OTC securities are not included.
- **Universe and metadata.** The Morningstar fundamental universe covers
  NYSE/NASDAQ/AMEX/BATS from January 1998, includes delisted companies and
  excludes ETFs, ADRs and OTC. It held about 8,700 companies before October
  2026 and 9,705 after.
- **The gap.** QC says Morningstar "doesn't provide fundamentals for every US
  equity". A common stock that has AlgoSeek prices but no Morningstar record can
  be missing from the universe we would select from. Neither dataset is
  documented as complete dated exchange membership.
- **Do not reuse the earlier diagnostic as is.** Morningstar fundamentals moved
  to new feeds for the *whole history* in October 2026. The new feed became the
  default on October 11 and the legacy feed is retired on October 31, 2026. QC
  says results "will change", and one forum reply reports that choosing the
  legacy version was silently ignored. The earlier 144-month universe
  diagnostic should be rerun, and each run should record in
  `dataset_revision` which feed it used.

## 2. Permanent identities, ticker changes, sectors and listing dates

| Need | What QC has | Status |
|---|---|---|
| Permanent ID | `Symbol.ID` stays the same across ticker changes (verified in LEAN source) | Supplied, not reviewed |
| Ticker history | Map-file rows hold date, ticker and an optional primary exchange; renames raise `SymbolChangedEvent` | Supplied, not reviewed |
| First trading date | `SecurityIdentifier.Date` is "the first date mentioned in the map_files". It is **left-censored** for anything already trading when coverage starts. Morningstar also has `IPODate`. | Partial |
| Sector, exchange, type | Morningstar `AssetClassification` and `SecurityReference` (ExchangeId, SecurityType, IsDepositaryReceipt, DelistingDate, DelistingReason) | **Unknown whether point-in-time** |

QC does not document whether historical classifications are point-in-time. A QC
staff forum answer on Morningstar point-in-time behaviour was "Yes; ish".
Morningstar itself says industry assignments change over time. Any record built
from QC metadata is therefore labelled `vendor_asof_unverified`.

## 3. Splits, dividends, mergers, spinoffs and delisting recoveries

Read in LEAN source:

- **Splits.** `ApplySplit` divides holdings by `SplitFactor`, so a 2-for-1 split
  has factor 0.5. LEAN pays fractional remainders as cash at the latest price.
  Frozen accounting v2 rejects fractional entitlements instead. That stays
  unchanged, and the new mapper passes such cases through so accounting can
  fail them (this is tested).
- **Dividends.** `Dividend.Create` *derives* the distribution from factor-file
  price ratios and rounds it to 2 decimals. The object has no pay, record or
  declaration date, no currency and no special-dividend flag. Accounting v2
  needs `pay_at` and the exact per-share amount. **QC cannot supply these.**
- **Mergers and acquisitions.** The Security Master lists "Mergers" as a data
  point, but the only documented history types are Split, Dividend,
  SymbolChangedEvent and Delisting. There is no consideration, exchange ratio or
  successor link.
- **Spinoffs.** Not mentioned anywhere in QC's corporate-action documentation.
  *Unverified risk:* because the distribution is derived from price factors, a
  spinoff adjustment could appear as a factor-derived "dividend". The mapper's
  declaration cross-check and accounting v2's large-distribution guard both
  block this case rather than book it as cash.
- **Delistings.** Delisting objects carry "the final price before delisting",
  and LEAN liquidates held positions. There are no OTC prices after delisting
  and no recovery value. The frozen protocol forbids treating last-price
  liquidation as a recovery.

**The only data gap that clearly needs a source outside QC is terminal-event
economics:** delisting returns and recoveries, plus merger and spinoff terms.

## 4. Point-in-time availability and look-ahead bias

- QC supplies no historical publication or correction timestamps for prices,
  actions or classifications. In backtests, corporate actions apply at midnight
  ET. Older fundamentals use a file date approximated as 45 days after the
  period.
- The October 2026 migration re-dated historical ratios. QC says some old feeds
  had assigned values before the underlying statements were public. The frozen
  strategy uses no fundamental ratios, but the change shows that vendor as-of
  dates have moved before.
- Backtest-clock availability is the vendor's claim, not evidence. Whether it is
  acceptable is a protocol decision that has to be made before any outcome is
  seen.

## 5. Validating without exporting licensed data

The code added here runs inside QC and reports **fixed codes only**: no IDs,
tickers, counts, dates or values.

- `qc_pit_bias_audit_v1.PitBiasAudit` is a streaming monthly audit. Its codes:
  - `UNEXPLAINED_EXIT`: an ID left the universe with no LEAN Delisting.
  - `REAPPEARED_AFTER_GAP`
  - `MISSING_DECISION_MONTH`, `EMPTY_SNAPSHOT`
  - `SNAPSHOT_NOT_BEFORE_DECISION`: the as-of time is not strictly before the
    08:00 ET decision.
  - `CLASSIFICATION_MISSING`
  - `CLASSIFICATION_NEVER_CHANGES_POSSIBLE_BACKFILL`: a large, long panel with
    zero sector changes. This is a heuristic flag, not proof.
- `qc_pit_audit_main.py` is an optional QC `main.py` that runs this audit over
  2000–2011. **It has not been run in QuantConnect yet.** The call shape for
  Delisting history is unverified on the owner's runtime, so any failure is
  reported as `EXIT_EXPLANATION_UNAVAILABLE`, never as a pass.
- Suggested next validator, not built: bring *public* reference figures (such
  as published yearly counts of exchange-listed companies) into the cloud and
  report only within-tolerance or out-of-tolerance. Those reference figures
  have not been sourced or checked here.

Operator steps, if the owner chooses to run it:

1. Back up the project's current `main.py`.
2. Add `qc_pit_bias_audit_v1.py` as a root file.
3. Replace `main.py` with `qc_pit_audit_main.py`.
4. Run Backtest and report only the final `SPORTSEDGE_QC_PIT_AUDIT_...` line.
5. Restore the original `main.py`.

## 6. What is still missing to connect QC to the frozen engine

`cloud_identity.run_in_cloud(source)` needs five methods:
`metadata`, `evidence`, `header`, `rows` and `benchmarks`.

**Built on this branch** (pure functions, tested with fake LEAN objects):

| Module | Role |
|---|---|
| `qc_lifecycle_mapper_v1` | Converts LEAN Split, Dividend, SymbolChangedEvent and Delisting objects into accounting-v2 events. Mapped split, rename and dividend events are accepted unchanged by the frozen accounting fixtures. It also projects each event into the frozen scorer's `actions` rows. A ratio with no exact decimal form (such as 2/3) blocks rather than being rounded. |
| `qc_identity_registry_v1` | Builds `stock_identity_bridge_v1.FIELDS` interval records from in-cloud snapshots plus map-file ticker history, then re-validates them with the frozen `IdentityRegistry`. Rename boundaries come from map-file dates, and interval ends become available only when observed. The vendor-code mapping is a reviewed input with no defaults. Left-censoring is tagged, and `left_censor_is_harmless` proves it cannot change 253-session eligibility for a given calendar. |

**Still missing:**

1. **Review evidence.** All ten `REVIEWS` entries, including the vendor-code
   mapping (exchange, security type, sector).
2. **A reviewed 1998–2011 exchange calendar and a T+3 settlement calendar.**
3. **Dividend declarations** (exact amount and pay date) from a source other
   than QC, cross-checked in-cloud.
4. **Terminal-event economics.** Without them, any held delisting, merger or
   spinoff stops the study, as designed.
5. **A pre-observation attribute policy.** The frozen bridge needs identity
   attributes across the whole 253-session lookback, but QC metadata is
   observed monthly. The default `block` policy stops; the
   `carry_back_first_observation` policy needs a protocol amendment.
6. **A row assembler** that turns QC bars into stream sessions (raw-open quotes
   with bid equal to ask, close marks, `prior_adv20_shares`), and a **monthly
   evidence assembler** (one shard per member from the PR #78 lookback reader,
   plus context and listings). Whether the full universe fits in Free-node
   memory is unverified.
7. **Registered benchmarks** (a licensed broad-market total-return index plus
   the 50/50 benchmark) and a dated risk-free rate. QC's ETF prices would need a
   pre-outcome amendment.
8. **Packaging.** The new modules are not yet in
   `scripts/package_stock_identity_cloud.py`. Adding them would change a PR #78
   file, so that is left for review.

## Paid subscription

Not shown to be needed. The owner's existing QC account already read AlgoSeek,
the Security Master and Morningstar in-cloud (the diagnostic plus the RAW smoke
PASS). Two things are still open:

- Whether a full-universe, six-account replay fits Free-node memory and
  runtime. Not measured.
- Terminal-event recoveries, which QC does not supply in any tier. A separate
  dataset (for example CRSP delisting returns through WRDS) is needed only if
  the protocol keeps requiring reviewed recoveries.

## Other finding: Windows checkouts break frozen hashes

With `core.autocrlf=true`, a Windows checkout rewrites frozen JSON and Python
files with CRLF endings. `verify_freezes()` then fails with "Original registered
protocol changed". Separately, `package_stock_identity_cloud.py` uses
`Path.write_text`, which writes CRLF on Windows, so its bootstrap fails the hash
check there. Linux CI and QC Cloud are not affected. A `.gitattributes` with
`* -text` for the frozen paths, plus `write_bytes` in the packager, would fix
this. Both changes are left out because they touch PR #78 and #53 files.

## Reproduce

```bash
python -m unittest discover -s integrations/quantconnect -p 'test_*.py' -v
python -m unittest discover -s analytics -p 'test_stock_*.py'
```

On Windows, clone with `git -c core.autocrlf=false clone ...`.

## Sources (read 2026-10-17)

- QC docs: [AlgoSeek US Equities](https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/algoseek/us-equities), [US Equity Security Master](https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/quantconnect/us-equity-security-master), [Morningstar US Fundamentals](https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/morningstar/us-fundamental-data), [Fundamental universes](https://www.quantconnect.com/docs/v2/writing-algorithms/universes/equity/fundamental-universes), [Corporate actions](https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions)
- LEAN source: `Common/SecurityIdentifier.cs`, `Common/Data/Auxiliary/MapFileRow.cs`, `Common/Data/Market/{Split,Dividend,Delisting}.cs`, `Common/Securities/SecurityPortfolioManager.cs`, `Common/Data/Fundamental/Generated/{SecurityReference,AssetClassification}.cs`, `Brokerages/Backtesting/BacktestingBrokerage.cs`
- QC forum: [Morningstar migration](https://www.quantconnect.com/forum/discussion/21449), [Morningstar point-in-time](https://www.quantconnect.com/forum/discussion/14856/is-quot-us-fundamental-data-morningstar-quot-point-in-time-data/), [ETN delisting liquidation](https://www.quantconnect.com/forum/discussion/8572/delisting-etn-effect-on-alphas/)
