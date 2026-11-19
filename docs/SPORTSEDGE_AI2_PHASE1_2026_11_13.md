# SportsEdge AI 2.0, phase 1: intelligence and learning (2026-11-13)

**Everything here is research only.**
- **Nothing deployed:** nothing was merged, deployed, scheduled or migrated.
- **Nothing changed:** no active model, pick rule, stake, budget, risk limit, frozen experiment file or PR #102 changed.

**Capability status** (the five levels are not interchangeable):

| Capability | Implemented | Tested | Deployed | Activated | Verified with real external evidence |
|---|---|---|---|---|---|
| Sports challengers v2 (4) | Yes (#164) | Yes | No | No | Retrospective on real box scores; real-line forward pending |
| Calendar-day rest fix | Yes (#164) | Yes | No | No | Defect measured on real data (22.5% mislabelled) |
| Stock research v3 (4) | Yes (#165) | Yes | No | No | Yes: real Alpaca bars, run 43488863136 |
| Learning engine (registry, diagnostics, hypotheses, evaluation) | Yes (C) | Yes | No | No | Ran read-only on the real props ledger (run 43489932456) |
| Research intake (sources, provenance, SEC facts parser) | Yes (D) | Yes | No | No | Parser tested on fixtures only; no collection job |
| /lab learning-engine panel | Yes (D) | Yes (build, smoke 52/52) | No | No | Reads the recorded registry |

## 1. Audit: what already existed
**Implemented and tested:**
- the sports ablation lab (frozen specs, clustered bootstrap, Holm, risk flags, mistake attribution);
- the stock psychology ablation and the weekly replay;
- the forward-ledger design;
- the review gate (500 lines, 14 dates, 50 games);
- `props-learn-v1` shadow scoring;
- the calibration and ledger audits;
- the research intake and discovery foundations.

**Implemented but inactive:**
- the Learning Lab forward tables (`props_lab_v1.sql` not applied);
- OpenAlex/arXiv discovery (no job runs it).

**Blocked by data:**
- injury/rotation (no permitted timestamped feed);
- sportsbook history;
- survivorship-free stock constituents;
- point-in-time fundamentals.

**Previously rejected:** 7 stock strategies (daily open/close losers, momentum-quality, 13F top-5, daily reversal, daily momentum, SPY trend-50, turn of month).

## 2. Sports AI (PR [#164](https://github.com/ang87505-crypto/SportsEdge/pull/164))
**Confirmed weaknesses** (two independent proxy folds and real lines):
- **More picks overconfident:** +8.4 / +6.4 pts, while Less is about 0. Real lines show the same: More 11/25, Less 32/51.
- **Model-vs-line gap ≥ 40%:** overconfident by +10.9 / +8.3 pts.
- **Volatile minutes:** overconfident by +6.7 / +6.2 pts.
- **Points:** the worst-calibrated stat.
- **Existing recalibration:** the single-slope recalibration (already in the `props-learn-v1` shadow) removes most of the More bias out of season.

**New challengers** (pre-registered in `035625f` before any run: side-asymmetric, uncertainty, line-gap, all):
- **Fold 1 (exploratory):** tiny but Holm-significant gains, about −0.0004 Brier.
- **Fold 2 (out of season):** none distinguishable.
- **Disposition:** all `NO_CLEAR_EFFECT`; they continue prospectively from 2026-11-14 with frozen weights.

**Defect found:** the learning layer's back-to-back flag is wrong for about 22.5% of lines (elapsed hours instead of calendar days). A tested fix exists; the change to the frozen production feature is proposed for after Monday.

**Unproven:**
- **Improvement:** nothing improves on the active model with real-line evidence.
- **Clustering:** the real-line sample of 76 picks comes from only 10 games.

## 3. Stocks AI (PR [#165](https://github.com/ang87505-crypto/SportsEdge/pull/165))
**Failure audit** (2023+ holdout): the live weekly rules returned 6.4%/yr vs SPY's 20.9%.
- **Exposure drag:** −10.0 pts/yr (53% average exposure).
- **Selection gap:** −4.5 pts/yr against exposure-matched SPY.

**Candidates** (pre-registered in `1116fe3`):
- **Risk-adjusted momentum:** REJECTED. It improves Sharpe (0.98 vs 0.59) but sits below exposure-matched SPY.
- **Momentum + low-vol:** NO_CLEAR_EFFECT.
- **Core-satellite:** NO_CLEAR_EFFECT. It beats the live rules (Holm p 0.0075) only by adding SPY exposure, and stays below SPY.
- **Core-satellite + risk-adjusted momentum:** REJECTED.

**Result:** NONE QUALIFIES. Nothing beats passive SPY at the same exposure after costs. The universe is survivorship-biased, which flatters every strategy.

**Forward testing still required:** none of these qualifies for it. The useful next step is data: survivorship-free constituents (paid; owner approval) and point-in-time fundamentals (SEC company facts; the parser is ready).

## 4. Automatic learning (PR C: `ai2/learning-engine`)
**Pipeline:** new verified results → data-quality checks → clustered diagnostics → hypothesis (deterministic, at most 2 per domain per run) → registered experiment → frozen prediction → verified outcome → evaluation → recommendation.

**Registry:** `research/engine/registry.json` holds 23 experiments, each with its hypothesis, dependencies, cutoff, code and dataset fingerprints, metrics, sample requirements, baseline, costs, decision rule and history.
- **Statuses:** `PROPOSED`, `RUNNING`, `INSUFFICIENT_DATA`, `FAILED`, `PROMISING`, `READY_FOR_REVIEW`, `REJECTED`.
- **No promotion status exists.**

**Safeguards:**
- rejected ideas are never re-proposed, and ideas under test are never duplicated;
- the same input is processed once;
- retrospective evidence reaches `PROMISING` at most;
- `READY_FOR_REVIEW` needs forward evidence meeting the registered minimums;
- the owner decides any promotion.

**When it runs:** manual dispatch only (`research-engine.yml`). A weekly schedule (`23 12 * * 2`) is proposed for owner approval after Monday.

**Real run** (read-only, real ledger):
- 271 lines, 0 quality issues, 76 picks;
- no significant pattern once game clustering is respected (10 games);
- 0 hypotheses proposed: correct behaviour for a small sample.

**Retraining:** scheduled retraining stays the existing `props-learn` weekly job; nothing new is activated. Research challengers are trained deterministically from pinned data with fixed seeds.

## 5. Autonomous research (PR D: `ai2/research-intake`)
**Connected** (code reads them in existing jobs):
- The Odds API (approved plan);
- ESPN box scores;
- SportsDataverse box CSVs (hash-pinned);
- Alpaca market data (read-only);
- SEC EDGAR 13F;
- QMOM holdings.

**Implemented, not running:**
- SEC XBRL company facts: a point-in-time parser keyed on filing dates, tested;
- OpenAlex and arXiv discovery.

**Proposed:** survivorship-free constituents (paid; owner approval).

**Blocked:**
- NBA official injury report (terms of use need owner review);
- NBA stats lineups (no permitted access).

**Verification:**
- every item needs a registered, approved source, a matching checksum and a valid retrieval time;
- point-in-time use also needs availability strictly before the decision cutoff, and a missing availability time excludes the item;
- literature only suggests hypotheses and never becomes a feature;
- no paywall bypass, scraping of restricted pages, purchases or LLM calls.

## 6. Learning Lab
- **Panel:** `/lab` gains a "Learning engine" panel from the recorded registry: counts by status and domain, ready-for-review (none), still collecting (with reasons), rejected ideas, and source status.
- **Forward tables:** `props_lab_v1.sql` is still not applied (production unchanged). The activation procedure is in `docs/SPORTSEDGE_CORE_RELEASE_FINAL.md` §13.

## 7. Delivery
**PRs:**

| PR | Branch | Contents |
|---|---|---|
| [#164](https://github.com/ang87505-crypto/SportsEdge/pull/164) | `ai2/sports-challengers` | Sports challengers v2 and the rest fix |
| [#165](https://github.com/ang87505-crypto/SportsEdge/pull/165) | `ai2/stocks-research` | Stock research v3 |
| PR C | `ai2/learning-engine` | Learning engine |
| PR D | `ai2/research-intake` | Research intake and the /lab panel; stacked on PR C |

**Tests (local):**
- sports lab: 41/41;
- engine: 10/10;
- intake and research: 18/18;
- stocks v3: 8/8 (with the analytics suite);
- tsc 0; eslint 0 errors; build OK; browser smoke 52/52.

**Reproduce:**
- **Sports:** see the #164 description (about 2 minutes on public box scores).
- **Stocks:** dispatch *Stock psychology research* with `experiment: v3` on `ai2/stocks-research`.
- **Engine, offline:**
  ```bash
  node --experimental-strip-types scripts/research-engine.ts --registry research/engine/registry.json --out /tmp/e --sports-rows rows.json
  ```

## 8. Owner actions (none needed before Monday)
1. **After Monday:** review and merge #164, #165, C and D (all research-only).
2. **Calendar-day rest fix:** approve the fix to the frozen production rest feature. It affects the `props-learn-v1` shadow and the lab layer only.
3. **Engine schedule:** approve the weekly research-engine schedule.
4. **Learning Lab:** apply `props_lab_v1.sql` so challengers collect forward evidence on real lines.
5. **SEC collection job:** approve a bounded collection job for point-in-time fundamentals (free, rate-limited).
6. **Optional:** a paid survivorship-free constituents source (cost decision).
7. **Optional:** review the NBA injury report terms of use.
8. **Policy question, not a model question:** the live 50% exposure cap.
