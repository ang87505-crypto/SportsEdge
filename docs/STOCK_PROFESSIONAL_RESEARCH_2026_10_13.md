# SportsEdge: professional research and implementation assessment

As of 2026-10-13. **Historical strategy performance: NOT MEASURED.**
No profitability, superiority or finished-algorithm claim is supported.
Recommendations below are engineering judgments informed by the listed sources,
not estimates of SportsEdge returns. This review uses official documentation,
publisher abstracts and accessible research descriptions; it is not a replication
of the cited studies or a claim that private institutional strategies are known.

## Verified dependency map

| Component | Exact verified commit | State / dependency |
|---|---|---|
| main | `1be3dd989e4ca321ff4e99e3a18658a3935d47a2` | Still current at inspection; original stock algorithms/protocol present |
| PR #43 accounting/readiness | `c9d569891682d8e88972c7b7a09067a7f41bd3bb` | Open, not merged; all 8 returned check runs successful; synthetic ledger/reporting only |
| PR #45 selector/cloud diagnostic | `7677d2e66b49d73bcb9c521a3388f3ea29da4f81` | Open, not merged; all 9 returned check runs successful; base of this additive milestone |
| PR #46 optional QC API | `ebce4b5ca37cac7ba38a0920accb7c642c65fe6d` | Open, not merged; all 9 returned checks successful; not required for manual free cloud research |
| PR #47 Alpaca read-only | `0284af01ae1a7c29df39b5e2ee22bcc90fa7ecee` | Draft/open, not merged; all 9 returned checks successful; no order automation |
| This branch | `research/stock-source-bridge-20261013` | Adds normalization/evidence bridge, offline event stream, tests and research notes; stacked on #45 |
| Genuine paired historical replay | No result | Blocked on admitted historical data, lifecycle accounting and execution reconciliation |

Applicable repository AGENTS.md contains Next.js-specific rules; no nested
AGENTS.md appears in the verified #45 tree. No Next.js implementation changed.
Git transport was unavailable. Source text was materialized from GitHub and
verified by Git blob SHA-1 against #45's tree; its binary favicon is not needed
locally and is preserved remotely by building an additive tree on the remote base.
No integration archive was supplied in this turn, so archive hashes were not
reverified here. PR #43's claimed archive verification is upstream evidence,
not a new independent claim. No existing source files were overwritten.

Frozen identities remain `stock-mom252-skip21-trend200-v1` and
`stock-mom252-skip21-trend200-holdrank10-v1`. The registered 2000–2011 development,
2012–2016 validation and 2017–2025 sealed windows, execution assumptions and
promotion rules are unchanged. No validation/test outcomes were requested.
The separate PR #15 study is unaffected.

## Prioritized research matrix

Priority ranks expected research value for this project, not expected returns.
No row has demonstrated incremental after-cost improvement over SportsEdge.

| Rank / family | Economic hypothesis and horizon | Evidence | Data, complexity and $1,000 suitability | Main failure mode / next test |
|---|---|---|---|---|
| 1. Frozen momentum and turnover discipline | Underreaction/persistence over months; retention may reduce churn | Peer-reviewed momentum [1]; practitioner transaction-cost research [6] | Daily raw data, actions and PIT universe; moderate engineering; whole-share concentration remains material | Momentum reversals, gaps, cash drag; finish paired registered test before optimizing |
| 2. Exposure and volatility management | Reduce exposure when risk rises; days/months | Moreira–Muir [4] | Price-based risk estimates; moderate complexity; cap exposure without leverage | Noisy estimates, selling after falls, whipsaws; separately preregister causal lagged estimates |
| 3. Quality/value rankings | Profitability/safety and relative price may complement momentum; months/years | QMJ [2], value/momentum [3] | Historical filing availability and classification; high data burden; five positions cannot replicate broad long/short factors | Revised fundamentals, sector bets, value traps; test one prespecified incremental feature only |
| 4. Earnings/guidance drift | Underreaction to genuine surprise; sessions/months | PEAD frictions evidence [7] | Timestamped releases plus contemporaneous expectations; moderate/high cost; poor fit for costly illiquid trades | Published anomaly disappears after costs; compare matched no-event baseline and realistic delay |
| 5. Regularized forecasts / boosting | Nonlinear interactions among existing predictors; monthly horizon | Gu–Kelly–Xiu [5] | Large PIT panel, chronological feature fitting; high complexity; start with regularized linear model | Flexible models overfit; nested development tuning, frozen calibration, logged research attempts |
| 6. Trend, factor-neutralization, regime models | Persistence or changing conditional risk; days/months | Futures trend evidence [12] is adjacent, not evidence for our exact equity rule | Neutrality needs many assets and often shorts; poor fit for five-name long-only account | Hidden leverage/short assumptions, unstable states; use factor attribution first, no new trading rules |
| 7. News language models and ensembles | Extract relevant unexpected information; minutes/sessions | Kirtac 2026 preprint [11] | Licensed histories, timestamp control, model-vintage evidence, inference costs; high complexity | Training-data contamination, latency, miscalibration; shadow classification before portfolio claims |
| 8. Political headline speed trading | React before price adjustment; milliseconds/seconds | Scharnowski [10] describes fast market response | Low-latency feeds/execution and event-time quotes; unsuitable current infrastructure | Signal arrives after reaction and spreads widen; prioritize risk annotations, not a speed race |

The baseline allocates at most half the account to equities. Compare it with the
registered 50% market/50% cash benchmark as well as the full-market benchmark;
lower volatility alone does not establish superior stock selection. Daily,
intraday and event-driven variants are research proposals requiring their own
protocols. No frequency sweep was run on the frozen study.

Professional practice worth adopting now: point-in-time data lineage, deterministic
accounting, cost-aware turnover, simple benchmarks, controlled research budgets
and prospective monitoring. Published factor or ML evidence does not certify this
five-stock, whole-share, $1,000 portfolio. Institutional trading cost estimates
also do not establish this account's actual fills.

## Event sources and feasibility

| Source / events | Access and historical limits | Timestamp / identity concern | Recommendation |
|---|---|---|---|
| SEC submissions and filings: earnings, guidance, restructuring, M&A, insider disclosures | Public JSON without API keys; fair-access limit 10 requests/sec aggregate [13–14]. Bulk files help historical processing | CIK identifies issuer, not a unique share class; contemporary ticker lists are not historical mappings. Acceptance/publication/first-observed times differ | First source for prospective shadow receipts; proposed collector cap 1 request/sec, cache/backoff; not activated |
| Fed monetary-policy releases | Official RSS categories [15]; public archives | Statement release is not a measure of surprise relative to expectations; publication date alone may lack precise receipt time | Low-cost policy-risk annotations; record locally observed time |
| BLS / economic announcements | Official release schedules and archives [16] | Revised values must not overwrite original vintages; ALFRED supports dated vintages [17], not subsecond receipt evidence | Calendar/risk context first; macro direction remains unproven |
| Government policy and verified political posts | Official releases where available; social API permissions and historical access vary | Impersonation, edits/deletions, source latency, indirect company relationships | Do not scrape prohibited sources; verify individual providers before adding. No social connector enabled |
| Company IR / exchange notices | Public pages differ by issuer; no uniform historical feed proven here | License/access review per source; retain corrections, issuer-to-security mapping, exact receipt | Future bounded allowlist; no broad scraping or assumed timestamps |
| FDA, cyber incidents, contracts, supply-chain and commodity shocks | Category-specific authoritative sources required; no unified source verified here | Binary outcomes, ambiguous materiality, secondary reports, stale discovery | Prospective research only after source-specific review |
| Video-game/hardware launches and consumer adoption | Announced schedules are commonly known; reliable sales/expectation histories not established | Scheduled launch is not surprise; public subsidiary may map indirectly to parent | Low priority until a defined measurable unexpected change is available |
| Licensed news/social vendors | Historical timestamps and entitlements depend on contract; no price quotation obtained | Historical correction version, redistribution rights, latency SLA and costs | Defer purchase until shadow tests show a reason to pay |

The offline prototype implements bounded ingestion, URL/receipt checks,
within-source revision deduplication, PIT mapping quarantine and deterministic
audit output. It explicitly leaves novelty, materiality, probabilities and
direction unassessed. It does not claim calibrated NLP or autonomous research.

For a future pipeline, retain immutable receipt -> validated source -> canonical
event/revision -> PIT entity mapping -> simple classifier -> model comparison ->
risk annotation -> audit. Source text is untrusted data. An LLM should receive
bounded content and a strict output schema, without order tools or credentials.
Keep raw-source access restricted to permitted license scope; protect the audit
store against modification. Durable storage/retries are future engineering.

Millisecond political-event reactions documented in [10] make free polling plus
LLM processing an implausible assumed speed advantage. Minute/hour drift could
still be investigated, but only from realistically executable timestamps; it is
not demonstrated. Multi-session earnings drift has stronger historical grounding
yet serious trading-cost limitations [7]. Event warnings and monthly risk context
are feasible early uses without presuming a directional alpha.

## Separate proposed experiment; not a protocol amendment

Track A remains frozen. Proposed Track B identity: `stock-event-increment-v0-draft`.
Hypothesis: a prespecified event feature improves a fixed decision metric beyond
existing lagged momentum/liquidity/risk inputs after delay and every cost.
This is a **draft**, not registered permission to inspect outcome data.

Track C should first collect prospective SEC/Fed receipts after a documented
start/version freeze. Historical news must not be described as untouched if the
model may have seen it during training. Record model release/training disclosure,
source vintage, exact prompts and hashes. Compare a form/category-only classifier,
a simple text model and one fixed LLM; abstain when source/mapping is uncertain.
Before any labels are examined, specify horizon, outcome label, evaluation sample,
cost assumptions, latency scenarios, tuning budget and go/no-go thresholds.

Score Brier/log loss and calibration against base rates, precision/recall under
class imbalance, false-alarm economic costs, detection/processing delay, and
feature ablations. Portfolio evaluation must retain returns, drawdown, volatility,
turnover, whole-share feasibility, cash drag, benchmarks, uncertainty, model/data
costs and execution-delay sensitivity. Split chronologically, fit preprocessing
only on development, and purge overlaps where labels span split boundaries.

Log every research attempt. Deflated Sharpe [8] and backtest-overfitting analysis
[9] are supplementary diagnostics for a new search, not replacements for the
frozen paired calendar-year bootstrap or approval gates. Few independent years
limit inference; random row splits or repeated holdout reuse are unacceptable.
No test result here constitutes evidence for the proposed feature.

## Alpaca and operational contracts

Official docs distinguish live IEX-only free coverage from consolidated SIP;
historical SIP requests can use an end time at least 15 minutes old [20]. Thus
previous-session SIP data appear compatible in principle with an 08:00 New York
decision. **Account access, complete bars and actual arrival before 08:00 have
not been verified**. The broker engineering session should record response feed,
retrieval time, regular-session aggregation convention, correction status and
calendar completeness before declaring readiness. Never substitute IEX volume.
Alpaca is not an approved replacement for the registered 2000–2011 study.

Paper trading is a simulation and does not reproduce all live execution effects
[21]. PR #47's account readout is not a scheduler, reconciled ledger or order
engine. No live or paper-order activation occurred here.

| Control | Classification | Deterministic condition / required evidence |
|---|---|---|
| Stale/partial prices, ambiguous IDs, unreviewed source, unsupported action | Hard block on new orders | Source/cutoff/calendar contract fails |
| Duplicate/unknown/partial orders, mismatched ledger, insufficient settled cash | Hard block on new orders | Broker reconciliation or unique decision/order identity fails |
| Position/sector/exposure or liquidity limit breach | Hard block on new orders | Frozen constraints or approved execution contract fails |
| High volatility, correlation, news risk, performance drift | Research alert initially | Prespecified lookbacks/reference distributions required; no fitted threshold here |
| Daily loss/drawdown or exceptional spreads | Operational warning until separately approved blocking limits | Thresholds and response policy must be explicitly registered and tested |

Reuse PR #45's safety contract; no additional guessed trading thresholds were
activated. Block new orders on uncertain critical evidence, log reason and
decision ID idempotently, and require broker reconciliation before resuming.
Suspension cannot guarantee liquidation or avoid existing-position losses.

## Cost and complexity decision

These are verified free-access descriptions or explicitly labeled budget scenarios,
not a bill quote. No paid service or inference was activated.

| Item | Free/local path | Paid/professional alternative and caveat |
|---|---|---|
| QuantConnect research | Free cloud access; B-MICRO 2 cores/8 GB, 20-second launch delay, 200 runs/day [18] | Higher nodes/tiers quoted dynamically; full-universe memory/runtime unmeasured |
| Historical licenses | QC hosted research within terms; external raw-data export not included [19] | Separately licensed local histories / institutional agreement; price not verified |
| Alpaca paper/data | Free paper-only account; free feed limitations; delayed historical SIP documented separately [20–21] | Algo Trader Plus $99/month [23]; unnecessary for this code milestone; verify paper-only entitlements |
| SEC/Fed data | $0 API/feed charge [13–15]; own compute and compliance effort | Dedicated licensed news or dissemination service; no quoted price |
| NLP/LLM | Current deterministic prototype makes zero inference calls | Model cost = input tokens × input rate + output tokens × output rate; quote selected model before activation |
| Hosting, storage, queues, monitoring | Local prototype incurs no new hosted-service charges | Existing quota availability unverified; no assumption of free always-on production |

Illustrative budget math, **not a return forecast**: $5/month is $60/year, 6% of a
$1,000 starting account; $20/month is 24% per year, before trading costs. On a
maximum $500 equity sleeve these fixed bills are especially demanding. Measure
incremental dollar benefit, not just classifier accuracy, before buying services.

## Next task and owner action

Highest priority: obtain a source-admission decision for the full frozen
development universe and lifecycle data, recording the post-migration vintage.
Then connect that admitted source to accounting v2 and reconcile both chronological
ledgers. This PR has not implemented a complete historical accounting engine.

Owner: run the existing single-file diagnostic in SportsEdge-Stock-Research once
and share only static status/non-data runtime errors. No keys in chat, no payment,
and no activation needed. If a source cannot satisfy the protocol, decide on a
documented pre-outcome amendment rather than quietly choosing easier dates.

## Sources (accessed 2026-10-13)

1. Jegadeesh & Titman, 1993, *Journal of Finance*, peer reviewed: [Returns to Buying Winners and Selling Losers](https://onlinelibrary.wiley.com/doi/full/10.1111/j.1540-6261.1993.tb04702.x). Broad momentum evidence, not our implementation.
2. Asness, Frazzini & Pedersen, 2019, *Review of Accounting Studies*, peer reviewed: [Quality minus junk](https://link.springer.com/article/10.1007/s11142-018-9470-2). Long/short diversified construction differs from our mandate.
3. Asness, Moskowitz & Pedersen, 2013, *Journal of Finance*, peer reviewed: [Value and Momentum Everywhere](https://onlinelibrary.wiley.com/doi/pdf/10.1111/jofi.12021). Cross-asset results do not establish small-account benefit.
4. Moreira & Muir, 2017, *Journal of Finance*; [NBER working version, 2016](https://www.nber.org/papers/w22208). Volatility-managed factors, not a guarantee of drawdown prevention.
5. Gu, Kelly & Xiu, 2020, *Review of Financial Studies*, peer reviewed: [Empirical Asset Pricing via Machine Learning](https://doi.org/10.1093/rfs/hhaa009). Large historical panel; replication and implementation frictions matter.
6. Frazzini, Israel & Moskowitz, 2012, AQR practitioner working paper: [Trading Costs of Asset Pricing Anomalies](https://www.aqr.com/insights/research/working-paper/trading-costs-of-asset-pricing-anomalies). Institutional execution sample, not retail fill evidence.
7. Chordia, Goyal, Sadka & Shivakumar, 2009, journal research: [Liquidity and the Post-Earnings-Announcement Drift](https://business.columbia.edu/faculty/research/liquidity-and-post-earnings-announcement-drift). Strong caution about illiquidity and net returns.
8. Bailey & Lopez de Prado, 2014, *Journal of Portfolio Management*: [The Deflated Sharpe Ratio](https://doi.org/10.3905/jpm.2014.40.5.094). Requires an honest account of selection attempts and assumptions.
9. Bailey, Borwein, Lopez de Prado & Zhu, revised 2015 manuscript / 2017 publication: [The Probability of Backtest Overfitting](https://escholarship.org/uc/item/4w1110bb). Diagnostic framework; not immunity from chronological leakage.
10. Scharnowski, 2026-03-02, *Journal of Financial Research*, peer reviewed: [Presidential tweets and after-hours market making](https://onlinelibrary.wiley.com/doi/10.1111/jfir.70049). First-term event sample; do not generalize to every future statement.
11. Kirtac, 2026-09-20 v1, preprint, revise-and-resubmit reported: [Financial Language Models under Market Frictions](https://arxiv.org/abs/2609.23703). Vendor-data/model-contamination limitations; not independently replicated here.
12. Moskowitz, Ooi & Pedersen, 2012, *Journal of Financial Economics*: [Time series momentum](https://doi.org/10.1016/j.jfineco.2011.11.003). Futures study, distinct from stock cross-sectional selection.
13. SEC, documentation dated 2024-06-06: [Public EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
14. SEC, current documentation: [Developer resources and fair access](https://www.sec.gov/about/developer-resources).
15. Federal Reserve, updated 2025-09-16: [RSS feeds](https://www.federalreserve.gov/feeds/feeds.htm).
16. BLS, current official page: [Release calendar](https://www.bls.gov/schedule/news_release/empSit.htm).
17. Federal Reserve Bank of St. Louis, current documentation: [ALFRED vintage data](https://alfred.stlouisfed.org/help/downloaddata).
18. QuantConnect, current official documentation: [Resources](https://www.quantconnect.com/docs/v2/cloud-platform/organizations/resources), [pricing](https://www.quantconnect.com/pricing), [Morningstar migration](https://www.quantconnect.com/docs/v2/writing-algorithms/universes/equity/morningstar-migration). Documentation mentions different rollout milestones; record actual project engine/feed rather than infer a vintage from calendar date alone.
19. QuantConnect, current terms: [Section 2.6](https://www.quantconnect.com/terms/). Keep hosted source observations in authorized cloud scope; do not export data through logs/API.
20. Alpaca, current official documentation: [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).
21. Alpaca, current official documentation: [Paper trading](https://docs.alpaca.markets/us/docs/paper-trading).
22. QuantConnect, current official documentation: [Corporate actions](https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions). Native portfolio adjustments must not be double-counted in a separate ledger.
23. Alpaca, current official documentation: [Market data plans](https://docs.alpaca.markets/us/docs/about-market-data-api). Basic historical data starts in 2016, so it cannot cover the registered development window. Paper-only documentation says IEX entitlement; confirm actual historical SIP access with the account before relying on the general FAQ.
