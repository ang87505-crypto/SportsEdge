# Confidence sizing, adaptation and research memory — 2026-11-19

This milestone integrates Claude's completed PR #187 with the current production learning scorecard from #189. It adds a separately versioned penny-sizing preview, rolling model diagnostics and durable dated research-source receipts. It changes no production model, pick threshold, actual paper stake or broker release setting.

## Penny sizing: exact map and activation boundary

`src/lib/lab/confidence-sizing.ts` implements `penny-excess-probability-v1` using integer probabilities in millionths and gross payout multiples in thousandths. For an even-money entry (2× gross payout), the rule is one cent per **complete percentage point above 50%**:

| Probability | Virtual stake |
|---|---:|
| 50% or less | $0.00 |
| 55% | $0.05 |
| 60% | $0.10 |
| 65% | $0.15 |
| 70% | $0.20 |
| 75% | $0.25 |
| 80% | $0.30 |
| 90% | $0.40 |
| 100% | $0.50 |

More generally, stake in cents is `floor(100 × max(0, entry_probability − 1/gross_multiple))`, capped at 50 cents, available virtual funds and $15 daily exposure. The integer implementation avoids floating-point rounding across cent boundaries. Missing payout terms produce zero, not an assumed price. Under equal payout and available funds, stakes never decrease as probability increases; caps and whole-cent rounding allow equal stakes.

The probability must describe the **complete paid entry**. Two independent 65% legs have an illustrative 42.25% joint probability, not 65%. At a 3× gross payout the illustrative stake is eight cents; at 2× it is zero. This multiplication assumes independence and is not a validated probability for any real entry. Real sizing needs calibrated probabilities and a dependence assessment.

Status is deliberately `PREVIEW_ONLY`, displayed in `/lab`. The existing `props_v1.sql` account requires at least $1 and records the fixed account stake; the frozen ablation shadow-stake table also requires whole dollars. Neither table nor existing evidence is rewritten. Activating cent-sized entries remains a separate milestone: introduce a versioned cohort, immutable per-entry sizing inputs and policy hash, settlement tests, and verify its database migration before use. The five existing staking-research methods and their evidence gate remain separate.

Historical sizing explanations now use the actual `graded_at` publication time and the latest grade revision known before entry creation. A game lock cannot substitute for result availability. Later settlements also cannot fund an earlier hypothetical entry. Unknown grade availability is excluded rather than backfilled.

## What “layers” means in the inspected NBA code

These are statistical feature groups, not hidden neural-network layers. The live baseline remains `props-nb-minutes-rate-v1`; declaring a group in the research registry does not make it active in production.

| Group | Mechanism | Current boundary |
|---|---|---|
| Base | Negative-binomial minutes × per-minute rate forecast | Production baseline |
| Recalibration | Per-stat intercept/slope on forecast log-odds | Supported research group; shadow evaluation |
| Role / minutes | Sustained role-change minutes rule | Supported research group; stand-alone historical swap previously rejected |
| Matchup / rest / opponent | Opponent allowed rates, home, rest, back-to-back | Supported research group |
| Sportsbook market | Same-line no-vig quote blend | Supported where pre-lock quotes were actually captured |
| Injury / rotation | Official pre-lock status | Unavailable: no verified timestamped feed is stored |

That is **one base plus four supported research groups**, with a fifth proposed group blocked by data. The sports registry lists nine feature definitions including the unavailable injury feature; feature count is not layer count. The nine-variant ablation experiment is also separate from the two production-shadow challengers. Its database migration is still an independent prerequisite for that full forward ledger.

The fastest useful next group is one with trustworthy pre-decision data and incremental predictive value. More groups alone provide no assurance of accuracy. Any addition needs a frozen hypothesis, chronological held-out evaluation, an ablation against the same baseline and enough independent forward games. Current evidence does not establish a profitable NBA edge.

## Adaptation as conditions change

The existing weekly trainer already uses recency weighting with a 60-day half-life and chronological validation. Capacity protection preserves existing shadow challengers rather than replacing them before they can reach the review gate.

The new `sports-drift-v1` diagnostic compares the latest seven days with the preceding 28 days. Both windows need at least 100 unique graded lines across ten games. It checks conditional binary Brier deterioration and, with enough selected picks and games, the stated-confidence gap. It uses seeded independent game resampling, effect-size floors and Holm correction across the tested metrics. Reports are `COLLECTING`, `NO_CLEAR_DRIFT` or `REVIEW_REQUESTED`.

A warning requests investigation of freshness and a bounded shadow retrain. It does not automatically retrain, replace an active model, relax review requirements or increase stakes. `NO_CLEAR_DRIFT` does not prove stability or predictive skill. The frozen promotion minimums stay 500 paired graded lines, 14 dates, 50 games and 100 candidate decisions, with the existing Brier interval and log-loss requirements. More frequent checks can identify an issue sooner; they cannot manufacture independent outcomes or guarantee improvement.

The engine now adopts newly reviewed seed experiments into restored state once, preserving pre-registration history. Existing IDs and rejected or overlapping ideas cannot be silently overwritten. This integrates Claude's stock research without resetting accumulated sports evidence.

## Current, relevant research with inspectable memory

The new `Research source memory` workflow runs after a successful main-branch learning evaluation, with a daily backup. A successful collection suppresses further collection that UTC day. A partial run stays visible and is not retried for six hours. Existing workflow publication uses the same `research-data` concurrency group, so archives cannot race other writers.

Sources are SEC company facts, OpenAlex and arXiv. Requests use fixed allowed hosts, GET only, redirect refusal, response-size limits, per-host spacing, timeouts and a hard budget of 40 requests in the scheduled workflow. Bounded retries honor a provider's `Retry-After`; a pause over one minute ends the attempt. No paid provider, model API or broker is involved.

Recent OpenAlex searches are sorted newest first and request 2025 onward on this release date. arXiv queries also sort newest first. The quality policy checks publication, update and retrieval timestamps; withdrawal/retraction flags; simple topic overlap; missing metadata; and instruction-like external text. It retains at most 80 unique literature records per run. Metadata passing these checks enters **method review**, not an accepted-evidence list. Quarantined items retain their rejection reasons. OpenAlex indexing is labelled scholarly metadata rather than automatically peer reviewed. All literature is hypothesis-only, even if a caller falsely labels it as a point-in-time feature.

Each run stores an immutable manifest, report and object-reference list. An append-only receipt records timestamp, source commit, source statuses and digests. Content-addressed objects exclude retrieval time, so unchanged content is reused across dates; changed content or quality flags produce a new object. Retrieval times remain in the dated receipt. A stored object and its dated receipt must be considered together for provenance. These source checks do not automatically evaluate a paper's methods or put web text into model weights. Newest-first bounded queries do not revisit every previously collected item; method review must recheck an older paper's current status before using it.

`/lab` reads and verifies the receipt/report/manifest hashes, shows partial failures and marks checks older than 48 hours stale. Missing or malformed state is explicitly unavailable. Code connection or a green build alone never establishes source freshness.

Official documentation checked November 19, 2026:

- [OpenAlex authentication and rate limits](https://help.openalex.org/api/authentication/): bounded basic queries permit keyless access; no key or account was created.
- [OpenAlex pulled works](https://help.openalex.org/data/works/pulled/): withdrawn/removed works are distinct from retractions; `include_pulled=false` explicitly excludes them. Provider flags can lag notices and are not a correctness guarantee.
- [arXiv API terms](https://info.arxiv.org/help/api/tou.html): a single connection at no more than one request per three seconds; descriptive metadata may be stored. This collector uses 3.1-second spacing and stores metadata rather than serving paper files.

Live pre-release check: eight literature requests succeeded, yielding 75 unique records after five duplicates were removed; five reached method review and 70 were quarantined. These are actual metadata-screen results, not validated studies or performance claims. The scheduled SEC-inclusive collection must publish its own receipt before production freshness is claimed.

## Claude integration and review

PR #187 adds an explicit stock session funnel from targets to submitted orders, actual fills and realized round trips. Shadow plans cannot count as orders or profits. This review also excluded order snapshots updated after the report cutoff and refused sessions whose orders lack a known earlier decision. Invalid report clocks fail explicitly.

The new hold-rank-ten stock challenger reduced historical turnover from 8.9× to 3.9× per year. At the judged 10-bps cost, its holdout Sharpe was 0.49 versus 0.47 for the current strategy and 1.27 for exposure-matched SPY. It failed the matched-SPY requirement and is research only. The current large-cap universe and inspected holdout limit interpretation. See Claude's committed pre-registration and results documents for the full assumptions.

The Nov 16 execution gap is now explained as `SHADOW_PLAN_ONLY`: targets existed, but there were zero submitted orders and fills in that run. The next supervised stock session runbook is Monday, November 23. Broker execution PR #102, owner Start and execution checks remain separate; this research milestone cannot activate them. Kalshi-specific access remains disabled; independent NOAA research continues separately.

## Verification and remaining work

Before final publication, the combined tree passed 949 JavaScript tests (996 discovered, 47 database-dependent skips) and 430 Python tests. The final research-memory regression suite passes 35 tests, including append-only index/object refusal, no objects written by a conflicting replay, incomplete-report refusal, provider retry timing and partial-run cadence. Production build, TypeScript and the owner-sign-in and shared-assistant HTTP checks pass. Lint has zero errors and six existing warnings. The exact published commit must also pass CI and responsive browser smoke before release.

The remaining activation boundaries are explicit: the cent cohort/database migration, missing injury data, full ablation database setup, sufficient independent forward outcomes, method review of literature and the separately supervised stock execution release. None is reported as completed by this milestone.
