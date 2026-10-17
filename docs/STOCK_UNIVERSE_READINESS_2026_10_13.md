# Stock universe and source-sample readiness

## Completed milestone

This additive milestone removes the aggregate 100,000-row limitation from the **new** scoring/account adapter, adds explicit known-short-history eligibility, and prepares a local source-sample preflight. The original baseline, candidate, accounting v2 and previous results remain byte-for-byte unchanged. There is still no historical-return evidence and no authorization to trade.

Inspected current main remains `ab97d6dcfb439418a64a145a1261d91bce7ac50a` (tree `501c6fef993af18527bfcf2dca38567d4f2dec90`). Work continues on the prior blob-verified stock snapshot plus the previous sixteen additive files. New isolated local branch: `research/stock-universe-readiness-20261013`. No remote commit, merge or deployment is claimed. The prior root AGENTS.md is unchanged and its Next.js-specific instructions do not apply to these Python modules.

## What changed

| Component | Behavior |
|---|---|
| `analytics/stock_universe_scoring_v1.py` | Processes one permanent security ID per bounded raw-price payload, calls the original baseline to calculate each mature security's scores, then returns all scores. Every declared universe member must appear exactly once. |
| `analytics/stock_universe_account_v1.py` | Applies the unchanged selection rules globally, derives equity/holdings from actual account state, and sends permanent-ID targets to the unchanged accounting-v2 kernel. Baseline and candidate have distinct account-bound decision identities. |
| `analytics/stock_source_sample_v1.py` | Checks declared research rights/development scope before opening source payloads, verifies raw-file SHA256 values, inventories missing source roles/events and reports unresolved gates. It does not authenticate a license or reconcile normalized values. |
| Two new test files | Synthetic arithmetic/parity, large-universe, timing, identity, IPO, omission, event-rejection and source-preflight tests. |

Versions are `stock-pit-universe-scoring-v1`, `stock-fulluniverse-account-adapter-v1`, and `stock-source-sample-preflight-v1`. `amendment.json` binds the protected dependency hashes. This is a versioned input/transport/eligibility extension, **not another selection hypothesis**. Only the original baseline and original hold-rank-ten candidate are compared. No parameter or threshold was tuned and no historical outcome was inspected.

The original baseline function still has its original input limits; it has not been rewritten. Large-universe integration must use the new adapter after review. Previous baseline/candidate signal endpoints are not silently redirected. The new adapter's report/decision envelope is explicitly different and includes its own adapter version and `selection_strategy` reference. It does not accept submitted signals, scores, equity, holdings or budgets.

### Full-universe semantics

Each input shard contains one permanent ID and only that security's normalized current symbol. Its payload still passes the original raw USD daily OHLCV parser and its per-payload row bound. Aggregate rows can exceed 100,000. A 400-security synthetic test supplies 101,600 observations; another passes that full universe through both account paths and verifies a single global five-name portfolio, not five names per shard. No market member is discarded for batching.

The original `generate` function computes mature securities' momentum, trend, price and dollar-volume filters. Global selection uses the unchanged `choose` helper: an empty incumbent set reproduces baseline rank/sector/count selection; the buffer strategy uses the actual account's incumbents. Tests compare original scores exactly and compare economic trade receipts with both original account planners on inputs they can process. Decision/trade IDs intentionally differ because they bind the new adapter contract.

This implementation bounds parser work per shard; it does not promise constant total memory or streaming historical replay. Reports retain per-security scores, marks, membership and source digests. The synthetic paired runner requires a reusable shard list. A complete market over many years still requires a source adapter and an efficient, reviewed chronological data pipeline.

### Known IPO versus unknown gap

Every member needs source-referenced `first_traded_on`, `available_at` and `source_id` listing evidence. The first date must mean earliest public trading of the same economic security. It must not be inferred from the first row a provider happened to return, a recent ticker rename, exchange transfer or a download's start date.

- With fewer than 253 completed sessions since that independently established first date, the security is explicitly `INELIGIBLE_KNOWN_SHORT_HISTORY`.
- Every completed post-listing session in the required window must nevertheless be present and timely. Missing or late observations invalidate the whole batch, including gaps in an IPO's short history.
- Earlier price observations contradicting a declared later listing are rejected.
- Exactly 253 completed sessions is sufficient; the original scoring rules then apply.
- An account already holding an ineligible short-history security is rejected for separate study-origin review. The adapter never silently deletes the holding or invents a liquidation.

Membership/source declarations remain unauthenticated here. Exact coverage relative to a supplied list does not establish that the list contains the historical market. Survivorship-free membership and first-trade evidence must come from reviewed sources.

## Data access finding and action required

The official UNM finance guide lists WRDS registration and CRSP access for UNM users. CRSP's current product page describes active/inactive securities, permanent identifiers and corporate actions. These are plausible sources, not proof that the user's individual account or intended SportsEdge use is authorized. No login, provider API, trial, purchase or licensed-price request was made.

**User action:** open https://libguides.unm.edu/finance/WRDS and establish whether the UNM WRDS account can access CRSP daily stock/security-history data. Confirm whether the proposed local research and any later service/commercial use are permitted. If export or AI-assisted processing is restricted, keep the data in the approved environment and provide only permitted schema/coverage information. Public availability of the guide is not a license grant.

Once access/use rights are confirmed, obtain a **small development-period sample only**. Use observations from the registered 2000–2011 development interval plus its necessary 1999 warmup. Do not export 2012–2016 validation or 2017–2025 sealed-test observations into the working sample. The manifest template's 2010 dates are placeholders for access/sample planning, not a new performance-evaluation period; set them to the actual approved sample's coverage.

### Sample export request

Request raw data and accompanying definitions; exact field names must be verified against the licensed product/release rather than copied from a legacy guide.

| Evidence | Required contents |
|---|---|
| Rights/use documentation | Exact product, permitted research environment/use/export/processing, restrictions, and source reference. Do not embed credentials. |
| Security master | Permanent IDs, full dated ticker/name/exchange/security-type history, historical sector mapping, first public trading dates, entry/exit/delisting statuses, and availability semantics. Include inactive securities. |
| Daily prices and liquidity | Raw unadjusted OHLC, volume and coverage basis, currency, session date, source observation/completion/publication/revision times or documented conservative timing; no silent conversion from adjusted prices. |
| Corporate actions | Ordinary dividend ex/record/pay dates and amounts, splits, aliases, delisting reasons, continuing OTC identity, merger consideration, spinoff/fractional rights, claim/payment dates, source-event identifiers and revisions. |
| Calendars | Actual exchange sessions/early closes and separate settlement-business dates with historical coverage/revision definitions. |
| Benchmarks | Licensed broad-market total-return series with definitions and availability; interest-rate evidence only if a later registered sensitivity requires it. |
| Field mapping | Product release/format, data dictionary, exact missing-value/sentinel meanings, price-sign conventions, volume conventions, total-return and delisting-return inclusion rules, rounding and timestamp assumptions. |

Include at least one source-referenced dividend, split, rename and delisting example. These examples establish format/event feasibility, not profitability. It is acceptable for these to involve different securities and development-period dates. Preserve original source bytes and checksums; retain all rejected/missing records and explain gaps. Do not replace absent prices/recoveries with zero or forward fills.

The current CRSP CIZ guide link was found, but the browser retrieval rejected its approximately 10.8 MB payload. No current CIZ field mapping is claimed. The publicly accessible WRDS legacy definitions show why product-version identification matters: a delisting amount may be an off-exchange price or a series of distributions, and sentinel values can encode missing outcomes. Such a return or value is not automatically cash spendable on the delisting date. A modern format may already incorporate events; applying a second legacy adjustment could double count them.

## Source preflight scope

`research/stock_universe_readiness_20261013/sample_manifest_TEMPLATE.json` deliberately starts with unconfirmed rights and empty source inventories. It cannot produce a ready-for-backtest result. File entries are `{ "path": "relative/path", "sha256": "64 lowercase hex characters" }`. Each event example refers to a verified corporate-action file hash, permanent ID and event ID.

```bash
python -m analytics.stock_source_sample_v1 \
  --manifest /absolute/path/to/completed-sample-manifest.json \
  --root /absolute/path/to/authorized-sample-folder \
  --output /absolute/path/to/NEW-sample-preflight.json
```

For `source_sample`, the guard rejects unconfirmed declared research rights or a declared period extending past 2011 before any source file read. This is a contract check, not an access-control sandbox: it cannot prove that a mislabeled file lacks later observations. Exports must be correctly scoped independently. A structurally complete report still says license/source authenticity and normalized-value reconciliation are unverified and `historical_backtest_ready=false`.

The checker does not download data, decode proprietary formats, authenticate legal rights, validate event economics, infer genuine availability timestamps or measure returns. It provides an exact inventory for the next source review.

## Corporate-event blocker remains explicit

No terminal-event accounting repair is claimed in this milestone. Accounting v2 still rejects delistings, mergers, spinoffs, fractional entitlements and combined actions. The new adapters preserve that rejection, and a regression test demonstrates it. The full study must stop on an unsupported case.

The next event contract must distinguish at least:

1. **Exchange delisting with continuing ownership/trading:** keep the same permanent-ID economic claim, obtain permitted OTC marks and a reviewed exit policy; do not cancel shares or create cash merely because exchange eligibility ended.
2. **Legally effective cancellation with documented cash consideration:** extinguish the correct old shares, create a separately valued receivable and book cash only at evidenced availability. Unknown recovery is not zero.
3. **Stock/mixed merger or spinoff:** map successor permanent IDs and legal exchange ratios, preserve previously earned dividends, handle fractional rights separately, and reconcile effective/known/payment timestamps.
4. **Cash-in-lieu:** preserve the fractional economic entitlement until source-evidenced valuation and cash payment; never round away value.

The SEC notes that shares can continue trading OTC after bankruptcy/delisting. This is why one generic “delisting payout” formula would be incorrect. A selected source's event definitions and sample must be reviewed before its records are admitted to the ledger. Generic event-contract development remains possible, but it would not establish compatibility with an uninspected source.

## Verification and reproducible integration

Apply the prior `SportsEdge_Stock_Candidate_Adapter_2026-10-13.zip` combined patch first, then this package's incremental patch. Both packages are additions only. Do not apply a second copy of the prior patch. Current upstream files and all prior sixteen additions must match their protected bytes. A clean full-tree-index application check verifies the patch chain; local tests use the previously documented partial stock snapshot.

```bash
# Run from that isolated SportsEdge research worktree after applying dependencies:
git apply --check /absolute/path/stock-universe-readiness-additions.patch
git apply /absolute/path/stock-universe-readiness-additions.patch
python -m unittest discover -s analytics -p 'test_stock*.py' -v
python -m unittest analytics.test_alpaca_history_archive -v
python research/stock_universe_readiness_20261013/reproduce.py \
  --output /absolute/path/NEW-universe-checks.json
```

Actual counts and commands are in `verification.json` and the delivered logs. All fixtures are synthetic; code tests do not imply returns or accuracy. Reproduction reports membership/identity/parity checks and no portfolio gains. No baseline/candidate/previous-file overwrite, NBA work, website work, source purchase, broker access, remote push, merge, deployment or test-period inspection occurred.

**Readiness after this milestone:** full-universe scoring and account routing are implemented and synthetically verified. Historical backtesting still requires permitted source data, source-to-model reconciliation, remaining corporate-event accounting, a reviewed execution proxy, benchmarks, and final protocol review. The original selection rules remain frozen.

## Primary sources checked October 13, 2026

- UNM finance guide: https://libguides.unm.edu/finance/WRDS
- Official CRSP database page: https://indexes.morningstar.com/research-data-products/crsp-us-stock-databases
- Current CIZ guide entry (full document not retrieved): https://indexes.morningstar.com/docs/guide/crsp-us-stock-databases-guide-for-flat-file-format-2-0?isRdp=true
- WRDS public legacy stock definitions: https://wrds-www.wharton.upenn.edu/demo/crsp/form/
- SEC/Investor.gov bankruptcy bulletin: https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-84
- SEC OTC overview: https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/over-counter-securities
