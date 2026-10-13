# Stock backtesting readiness integration — 2026-10-13

This branch implements and tests research infrastructure. **Genuine historical performance remains Not measured.** The complete survivorship-aware historical simulator is not finished: terminal corporate events and a reviewed source adapter are still blockers. Neither frozen strategy has demonstrated profitability.

## Source and integration evidence

GitHub main was confirmed at `1be3dd989e4ca321ff4e99e3a18658a3935d47a2`, tree `9200857459100716ed30bd87e33d3cf4a6a2db35`. `github_inventory.json` records all branch heads, open PR heads and file checks across relevant stock branches. None contained the three identifying new accounting/candidate/universe modules.

Both nested archive SHA-256 values match the kit manifest; every internal manifest entry was checked. The 27 imported source files remain byte-identical to their archives. Accounting v2 was imported only through the candidate package. `integration_manifest.json` records archive/source hashes and preservation of PR #15 and merged PR #40. The outer archive hash is recorded for provenance; no independently supplied outer reference hash existed.

Authenticated Git transport was unavailable. 169 text blobs were obtained through authorized GitHub access and independently matched to Git object SHA-1. The binary favicon was unavailable locally and is preserved by creating the remote tree as additive changes against the exact original GitHub tree. The local snapshot commit is not claimed to be GitHub main. No NBA, sportsbook, original strategy, original protocol, manual journal or inherited result file is changed.

## Implemented

- All three previous research packages: exact accounting-v2, account-derived candidate adapter, full-universe scoring/known-IPO eligibility and local source preflight.
- A single offline synthetic pipeline: two independent $1,000 cash-only accounts, two monthly decisions, 23 sessions, primary 15-bp nominal one-way costs and 25/50-bp sensitivity cases with the registered $1/order sensitivity fee. All six account/scenario outputs repeat exactly.
- An independent ledger verifier rebuilds positions, settled/unsettled cash and dividend claims from receipts, checks each order's integer-cent rounding, checks transaction costs against opening NAV loss, and recalculates every closing NAV without calling the kernel's NAV/rounding helpers. Deliberately corrupted receipts, cash, shares and NAV fail.
- Reporting math for net P/L, CAGR, maximum drawdown/duration, annualized monthly volatility, optional excess-return Sharpe and the registered paired calendar-year bootstrap (10,000 draws; seed 20261012). Statistical tests use synthetic arrays only. Complete contiguous year blocks are required; fewer than two blocks returns no interval. Percentile convention is nearest-rank 2.5/97.5%, documented before historical evaluation.
- Read-only website report contract, server loader, empty reviewed SHA-256 publication allowlist and professional research comparison interface. It includes equity/cumulative returns, net P/L, risk metrics, costs, turnover, exposure/cash metrics, trade ledger, benchmark curves, uncertainty and version/provenance fields. A report must pass hash approval plus schema, frozen protocol/version/cost and basic NAV/metric checks. Hash approval is an independent review step, not automatic proof that data are true.
- Missing, unreadable, unapproved, synthetic and invalid reports render **Not measured**. No performance artifact has been approved. The page is independent of the manual journal, PR #15 forward study and brokerage account.
- Dedicated stock CI repeats all inherited analytics tests, three package reproductions, the dry run and the blocked readiness report. Existing CI exercises Node tests/lint/build/types.
- Branch-specific `vercel.json` disables automatic deployment for `research/stock-backtest-readiness-20261013`. No merge, deployment or trading activation is part of this milestone.

## Verification

Local Python: **326 tests passed**; Node: **53 tests passed**. The six pipeline tests were rerun after adding stricter per-session cost reconciliation and the protocol hash check. Production build passed. Typecheck passed after Next generated its route types; the earlier pre-build typecheck lacked inherited `LayoutProps`. Lint has zero errors and one pre-existing warning in `scripts/browser-smoke.mjs:26` (unrelated to this work).

Synthetic dry-run output is committed in `research/stock_readiness_20261013/synthetic_dry_run.json`; its performance field is null and its kind prominently says synthetic engineering only. Generated results were repeated byte-for-byte. These fictional values are accounting checks, never strategy-return evidence.

Local headless browser startup was blocked because Chromium is absent and the permitted download returned invalid/truncated archives. This is not recorded as a successful visual QA run. The production route returned HTTP 200 with the comparison heading, 54 Not measured occurrences in HTML, and no synthetic fixture ending-NAV value. Remote CI browser evidence is recorded separately when available.

## Data readiness and alternatives

No authorized price/universe archive was supplied in this integration kit or located in the accessible repository/Library filename searches. This does not prove no archive exists elsewhere. The repository contains read-only Alpaca collector and engineering-gate code; this session did not invoke collection, retrieve credentials or access an account. The readiness artifact is **BLOCKED**, with performance null. No development, validation or sealed historical returns were computed.

Official public documentation reviewed on 2026-10-13:

| Source | Potential use | Why it does not admit this study now |
|---|---|---|
| [Alpaca historical data](https://docs.alpaca.markets/us/docs/market-data-faq) | Authorized 2026 source/format engineering. SIP is consolidated; IEX is one exchange. | No full licensed 1999–2011 PIT dataset supplied; symbol-based bars and actions do not establish historical universe completeness or source availability semantics. Historical SIP access and entitlement must be confirmed; no purchase is implied. |
| [CRSP US Stock Database](https://www.crsp.org/research__trashed/crsp-us-stock-databases/) | Active/inactive securities, permanent IDs, corporate actions and long daily history. WRDS is a supported access route. | User's request remains unapproved. Exact licensed product/release, fields, export/AI processing and website publication rights remain unverified. Product capability is not a license grant. |
| [Norgate packages](https://norgatedata.com/stockmarketpackages.php) and [FAQ](https://norgatedata.com/data-package-faq.php) | Paid alternative worth a schema review if separately authorized; packages include delisted/OTC history. | FAQ says prior tickers, exact historical exchange location and events after final delisting are not supplied. It is not a drop-in match for the frozen contract; supplementary evidence or a pre-outcome protocol amendment would be required. No subscription/trial was started. |

The original frozen development period remains 2000–2011, with 1999 or earlier warmup; validation 2012–2016 and sealed test 2017–2025 were not opened. No current-survivor basket replaces the historical market.

## Exact missing evidence and engineering

1. **Rights**: licensed product/release, individual access, local analysis, export and AI-processing permission, and separate derived-report/website publication rights. Keep restricted source bytes in their approved environment.
2. **Universe/identity**: full dated NYSE/NASDAQ/AMEX common-stock membership, inactive names, permanent IDs, first public trading dates, type/exchange/sector history and ticker aliases with knowledge timestamps.
3. **Market evidence**: raw USD OHLC, consolidated volume, completed/available/revision semantics, reconciled split/dividend total-return adjustments, rejected/missing records and source-file hashes.
4. **Calendars and execution**: complete exchange/settlement calendars, missing/halted opens, documented opening-price proxy and liquidity assumptions. Synthetic displayed sizes are never historical fill evidence. Nominal costs use 5-bp half-spread and remaining slippage on bid/ask (multiplicative), followed by per-order rounding.
5. **Corporate claims**: legally effective cancellation versus continuing OTC ownership, cash/stock/mixed consideration, successor IDs, exchange ratios, fractional rights, valuation/payment timing and unresolved recoveries. Accounting v2 currently fails the entire study on delisting/merger/spinoff/fractional/combined unsupported events; unknown recovery is never zero. Complete source-to-ledger normalization and these event lifecycles must be implemented and independently reconciled before an affected history can run.
6. **Benchmarks/statistics**: licensed broad-market total-return data, consistently simulated 50/50 benchmark/cash convention, dated accessible risk-free rates for Sharpe (otherwise null), and attestation of previous holdout exposure.

**Minimum next action:** obtain the pending WRDS/CRSP access decision and permitted-use confirmation, then provide a development-only source sample and its current data dictionary, including a dividend, split, rename and terminal event. The existing preflight inventories its exact files/hashes. Implement and reconcile the source/event adapter, acquire the full frozen development coverage plus benchmarks, and independently approve execution/source gates. Only then can development returns be measured; validation and sealed test require their sequential frozen decision gates. No amount of additional synthetic testing substitutes for these facts.

## Reproduce

```bash
python -m unittest discover -s analytics -p 'test_*.py' -v
node --test src/lib/ingestion/*.test.mjs src/lib/research-math.test.mjs src/lib/result-validation.test.mjs src/lib/stocks/*.test.mjs
python -m analytics.stock_readiness_pipeline_v1 --mode synthetic --output NEW-synthetic.json
python -m analytics.stock_readiness_pipeline_v1 --mode readiness --output NEW-readiness.json
npm run lint
npm run build
npx tsc --noEmit
```

The runner refuses output overwrites. `--mode readiness` is a no-data/no-network inventory, not a license authenticator. The original source-sample and Alpaca gates remain separate, restricted engineering tools. There is intentionally no CLI flag to bypass historical admission.

To publish a future reviewed report, place the exact approved JSON at `research/stock_reports/approved-report.json` and add its exact byte SHA-256 to `src/data/research/stock_report_approvals.json` through review. `BacktestReport` defines the public schema. Never place licensed raw observations in a public artifact. A downstream historical exporter is still pending the source/event simulator; this PR does not pretend to produce a validated historical report automatically.
