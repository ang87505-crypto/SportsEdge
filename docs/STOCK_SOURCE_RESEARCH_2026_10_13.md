# SportsEdge research milestone — 2026-10-13

## Verified dependency map

GitHub main is still `1be3dd989e4ca321ff4e99e3a18658a3935d47a2`.
All four requested PRs were open and unmerged when inspected:

| Work | Exact head | Role / limitation |
|---|---|---|
| #43 | c9d569891682d8e88972c7b7a09067a7f41bd3bb | Accounting v2, candidate/universe adapters, synthetic comparison/reporting; not genuine history |
| #45 | 7677d2e66b49d73bcb9c521a3388f3ea29da4f81 | Frozen selector parity, safety contracts, metadata diagnostic |
| #46 | ebce4b5ca37cac7ba38a0920accb7c642c65fe6d | Optional read-only paid QC API path; not needed for manual cloud research |
| #47 | 0284af01ae1a7c29df39b5e2ee22bcc90fa7ecee | Alpaca read-only paper connection; owned by separate engineering track |

This additive branch is based on #45. It does not merge #43, #46 or #47 and
must not be mistaken for an integrated production release. Only applicable
AGENTS.md in #45 tree is the root Next.js guide; this milestone edits no Next.js
code. Local source subset was reconstructed from existing copies only when Git
blob SHA matched the exact GitHub recursive tree. Frozen protocol and selectors
remain byte-for-byte unchanged. No private market history was acquired. Git
clone was unavailable; GitHub connector is used for isolated publication.

Dependency: #43 audited accounting + #45 frozen selection + admitted historical
source + corporate-event/calendar/benchmark reconciliation -> development replay
-> registered validation gate -> sealed-test gate -> separate paper readiness.
New raw-history diagnostic advances source engineering only. The event prototype
has no dependency on, or path into, the frozen selector.

## Genuine evidence and the material new blocker

**NOT MEASURED**: after-cost return, CAGR, drawdown, Sharpe, incremental candidate
benefit, event-classifier performance and paper-execution performance. Synthetic
tests prove specific implementation properties, not investment performance.

QuantConnect's current Morningstar documentation reports a rebuilt full history
and changed filing timing. Its dataset page names September 23, while its
migration page describes master switching October 10 and retirement October 31.
These pages are not fully consistent. Record actual dataset generation and LEAN
engine version; do not infer them from the run date. Source revisions can change
past universes even when strategy code is unchanged. [9,10]

The source gate cannot be passed just by retrieving 253 prices. Missing point-in-
time membership, historic classifications, initial dates, delisting/merger/
spin-off recoveries and dividend payable dates are economic blockers. LEAN bar
end times cannot be relabeled verified historical publication times. Dividends
must not be immediately spent at ex-date if payable later. Unsupported events
must stop replay, not silently remove the security. Frozen 15/25/50-bp costs,
$1/order sensitivity, $1,000 capital, whole shares and registered bootstrap remain.

## Prioritized professional research matrix

Ranks are engineering judgments for this project, not measured return rankings.
All incremental after-cost advantages versus SportsEdge are NOT MEASURED.

| Rank / family | Hypothesis and horizon | Evidence | Inputs / complexity / costs | $1,000 suitability and failures |
|---|---|---|---|---|
| 1 Momentum/trend and implementation | Persistent relative performance; months | Jegadeesh–Titman peer-reviewed [1]; exact SportsEdge rules not studied | PIT prices/actions/membership; medium data burden | Best immediate test target; five names and whole shares differ materially from academic diversified long-short portfolios; crashes, cash drag, gaps |
| 2 Quality/value | Productive or cheap firms earn a premium; quarters/years | Novy-Marx [2] | Vintage fundamentals, filing availability; medium/high data burden | Separate experiment only; restatement leakage, sector confounding, prolonged underperformance |
| 3 Risk/volatility management | Reduce risk when conditional variance rises; days/months | Moreira–Muir [3] | Lagged returns, cost-aware exposure caps; medium complexity | No leverage for this account; exposure changes can add turnover, miss rebounds, or worsen returns; paper results do not validate our cap choices |
| 4 Post-earnings effects | Incomplete reaction to unexpected earnings; sessions/weeks | Bernard–Thomas [4] | Timestamped releases, point-in-time expectations, prices and spreads; high data burden | Researchable shadow track; public filing may follow first release; surprise data and costs can eliminate effect |
| 5 Regularized forecasts/boosting | Nonlinear interactions forecast conditional returns; weeks/months | Gu–Kelly–Xiu [5] | Many clean PIT features, nested chronological training; high complexity | Start with linear/shrinkage baselines; sample instability, turnover, training leakage and capital granularity |
| 6 Financial NLP / LLM events | Extract incremental structured information from text; sessions | Domain-dictionary evidence [6]; recent Kirtac preprint [7] | Versioned text, model training cutoff, calibration, licensed news; high complexity | Test against cheap classifiers; linguistic accuracy is not net alpha; hallucination, model-history contamination and recurring fees |
| 7 Regime ensembles / factor neutrality | Condition exposures and diversify risks | Plausible extensions, not validated here | Large stable samples, factor exposures and covariance estimates | Five positions/long-only constraints limit neutrality; regime hindsight and parameter mining; defer |
| 8 Headline/political/social latency trading | React before repricing; milliseconds/minutes | Scharnowski 2026 existence verified, full results not retrieved [8] | Fast licensed feeds, quote-level execution and market access; very high burden | Poor present fit; no demonstrated speed edge. Do not build a paid latency race |

Calendar-based product launches (games/hardware) contain widely anticipated
information. Better questions are unexpected delays, guidance or disclosed sales
relative to *prior* expectations. FDA, cyber incidents and geopolitical shocks
are potentially material but direction is ambiguous, entity links are indirect,
and halts/gaps can dominate. Use reviewed alerts first, prospective tests second.

Academic findings motivate hypotheses; none demonstrate SportsEdge profitability.
This review examined primary-source summaries/abstracts and official docs; it is
not a replication or full-text systematic review of every paper.

## Statistical discipline

Keep the one frozen candidate and its original promotion rule. Record all new
trials, including discarded features. DSR addresses selection/non-normality [11];
PBO studies selection among backtests [12]; multiple-testing research rejects
casual significance after many attempts [13]. They do not substitute for source
integrity or automatically replace our registered paired calendar-year bootstrap.
Do not calculate a fictitious PBO from one strategy or claim DSR without a trial
inventory. New ML studies need chronological nested selection, purge/embargo for
overlapping labels and a truly untouched future reserve. Report few-block
uncertainty and economic significance, not only a p-value or attractive Sharpe.

## Low-cost event source assessment

| Source | Freshness/history/identity | Access and limitations | Priority |
|---|---|---|---|
| SEC filings/XBRL [14,15] | Public submissions with CIK/accession; archive rich but ingestion latency not historical receipt proof | Free APIs; identified client, <=10 req/s aggregate; revisions, issuer-to-share-class mapping, licensing of exhibits still matter | First shadow source |
| Federal Reserve RSS [16] | Official announcement source and archive; feed polling is not instantaneous | Public feed; follow terms/cache/backoff; no market-consensus surprise series | Macro/risk context |
| BLS API [17] | Official economic series; revised values need vintage treatment | Unregistered 25 queries/day, registered 500; not a low-latency surprise feed | Context, not execution trigger |
| Company IR / exchange / FDA | Authoritative for their releases; heterogeneous archives and identifiers | Review each host and rights/rates before adding; no connector implemented | Later selected sources |
| Political social accounts | Potentially rapid, with deletions/impersonation and ambiguous firm links | Official API/license review required; no scraping bypass; no verified free low-latency entitlement | Defer trading use |
| Licensed news/expectations | Potential broad coverage; vendor timestamps are not our ingestion receipts | Historical/as-of rights and current quote required; no service purchased | Only after simple baseline shows value |

Service architecture and timestamp/security schema are in event_shadow_v1.
Continuous collection would not authorize trading outside allowed market hours.
Seconds-level detection age must be measured through executable price availability,
not just publication time. The implemented prototype is OFFLINE, not a 24/7 service.

## Alpaca handoff and deterministic safety contract

Alpaca documents Basic as free with IEX real-time coverage, and historical SIP
queries when explicit end is at least 15 minutes old [18,19]. Thus yesterday's
SIP bars appear queryable before 08:00 the next session in principle. Actual
account entitlement, overnight correction behavior, completeness and availability
have NOT been independently verified with this user's account. That is not a
production approval. Historical stock coverage starts in 2016, so cannot replace
2000–2011. Always request SIP explicitly for consolidated liquidity; never silently
fall back to IEX. No account credentials or orders used here.

The execution owner should accept only a versioned, hashed signal envelope:
strategy/protocol identity; decision and strict input-availability timestamps;
permanent IDs/current mappings; target weights and whole-share constraints;
input snapshot hash; evidence status; reason codes; expiry and idempotency key.
A research-target output is insufficient to authorize an order.

| Severity | Deterministic condition | Required response |
|---|---|---|
| Hard block | Missing source evidence, unknown action, stale decision, unresolved order, NAV mismatch beyond approved cents tolerance, or unapproved strategy | Decline new orders; immutable reason, snapshot and policy hash; reconcile before reset |
| Hard block with approved threshold | Daily loss/equity-open or 1-NAV/running peak reaches registered limit; exposure/sector cap exceeded | Block new orders; do not assume safe liquidation |
| Operational warning | Provider latency, partial fill awaiting receipt, degraded poll heartbeat | Escalate and block when critical freshness/uncertainty threshold exceeded |
| Research alert | Model drift, unusual correlation/volatility, reviewed material news | Review; no automatic strategy modification or unsupported forced sale |

Thresholds must be approved and frozen before activation; examples in existing
safety.py are not production policy. Evaluate money in integer cents, prices in
exact decimals, approved rounding; use broker-versus-ledger reconciliations.
A stop prevents new orders, not gap losses or guaranteed exits. No new risk
thresholds were enabled and no safety monitoring service is running.

## Monthly cost decision

| Resource | Free/current option | Paid alternative / decision |
|---|---|---|
| QC cloud research [20,21] | $0 Free, one B-MICRO, 8 GB; manual run | Paid plan/node not needed merely to try this diagnostic; full-universe runtime unmeasured |
| Historical rights [22] | Hosted data stays in QC | Separate export/vendor licenses require quotation; no invented estimate |
| Alpaca data [19] | Basic $0; delayed historical SIP per FAQ | Plus $99/month for real-time consolidated data; presently unnecessary for prior-day research |
| SEC/Fed | $0 source subscription | Collector hosting/operations still costs resources |
| News/expectations | No paid feed selected | Obtain license quote only after prospective benefit; no assumed free commercial redistribution |
| NLP/LLM | $0 model API spend for this offline deterministic prototype | Budget = events x tokens/event x token rate plus retries; no paid model or price assumed |
| Hosting/queue/database/monitoring | No new service activated, $0 added by this work | Actual usage/quota and existing plan must be inspected; 24/7 hosting is not established as free |

Arithmetic, not forecast: $10/month is $120/year, 12% of $1,000 capital;
$99/month is $1,188/year, 118.8%, before trading costs. Shared infrastructure may
serve more capital later, but that does not justify charging it to an unproven
$1,000 study. Prioritize source integrity and correct economics over AI spend.

## Next milestone and owner actions

Highest priority: execute and inspect the source diagnostic inside the existing
QC project, record engine/data generation, and resolve source/event evidence
with the provider before wiring actual portfolio replay. No extra subscription
or API token is needed for the manual diagnostic. Owner should retain source
data inside QC and share only non-data runtime errors. Do not open validation
or sealed returns. No need to connect Alpaca for this milestone.

Local verification: 101 existing stock tests, 31 existing QC tests, seven new
coverage tests and nine new event tests passed (148 total). No failures locally.
No real LEAN cloud run, source-admission test, broker test, paid request or
performance evaluation occurred. Exact-head CI is checked after publication.

## References (accessed 2026-10-13)

1. Jegadeesh & Titman (1993), Journal of Finance, peer-reviewed: https://doi.org/10.1111/j.1540-6261.1993.tb04702.x
2. Novy-Marx (2013), Journal of Financial Economics, peer-reviewed: https://doi.org/10.1016/j.jfineco.2013.01.003
3. Moreira & Muir (2017), Journal of Finance, peer-reviewed: https://doi.org/10.1111/jofi.12513
4. Bernard & Thomas (1989), Journal of Accounting Research, peer-reviewed: https://www.jstor.org/stable/2491062 (bibliographic record checked; no full-text replication)
5. Gu, Kelly & Xiu (2020), Review of Financial Studies, peer-reviewed: https://doi.org/10.1093/rfs/hhaa009
6. Loughran & McDonald (2011), Journal of Finance, peer-reviewed: https://doi.org/10.1111/j.1540-6261.2010.01625.x
7. Kirtac (September 20, 2026), research preprint, not established peer-reviewed replication: https://arxiv.org/abs/2609.23703 . Reports a framework using licensed news/CRSP; its claimed results are not transferred to SportsEdge.
8. Scharnowski (March 2, 2026), Journal of Financial Research: https://doi.org/10.1111/jfir.70049 . Publisher early-view listing verified; full article inaccessible through retrieval. No quantitative claims used.
9. QuantConnect, official current dataset documentation: https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/morningstar/us-fundamental-data
10. QuantConnect, official migration documentation: https://www.quantconnect.com/docs/v2/writing-algorithms/universes/equity/morningstar-migration
11. Bailey & Lopez de Prado (2014), Journal of Portfolio Management: https://doi.org/10.2139/ssrn.2460551
12. Bailey, Borwein, Lopez de Prado & Zhu (2017), Journal of Computational Finance, author repository: https://escholarship.org/uc/item/4w1110bb
13. Harvey, Liu & Zhu (2016), Review of Financial Studies: https://doi.org/10.1093/rfs/hhv059
14. SEC, official APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
15. SEC, developer/fair access: https://www.sec.gov/about/developer-resources and https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits
16. Federal Reserve, official RSS (updated September 16, 2025): https://www.federalreserve.gov/feeds/feeds.htm
17. BLS, official API limits: https://www.bls.gov/developers/api_faqs.htm
18. Alpaca, official market-data FAQ: https://docs.alpaca.markets/us/docs/market-data-faq
19. Alpaca, official plans/history: https://docs.alpaca.markets/us/docs/about-market-data-api
20. QuantConnect, current pricing: https://www.quantconnect.com/pricing
21. QuantConnect, node resources: https://www.quantconnect.com/docs/v2/cloud-platform/organizations/resources
22. QuantConnect, terms version 1.5 October 8, 2026, hosted data restrictions: https://www.quantconnect.com/terms/
23. QuantConnect, raw/unfilled history options: https://www.quantconnect.com/docs/v2/writing-algorithms/historical-data/history-requests
