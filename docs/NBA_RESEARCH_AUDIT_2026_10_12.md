# NBA quantitative research milestone — 2026-10-12

## Decision

**No reliable betting advantage demonstrated. Do not promote or activate a model.**

Identity-normalized Elo with 75% offseason carryover is the strongest fixed candidate by the earlier validation log-loss rule. It improves retrospective prediction scores relative to legacy Elo, but remains worse than the archived betting market. Its positive later-period scenario ROI is small, uncertain, and disappears with a five-cent assumed cost per $10 wager. Across the entire evaluated archive it loses more than legacy Elo.

This milestone is complete as an offline reproducibility and candidate-comparison audit. A genuinely untouched historical test and executable historical ROI are **not available**. No relabeling or split can undo prior examination of these games. The reserved future 2026–27 holdout has no results in this deliverable and requires a separate reviewed prospective collection/model freeze before it can be used.

## Scope and provenance

Inspected main `261b03ccc78e0fb3f62fdfa85effcb1e4e9f2f72`, the repository tree, NBA algorithms, parsers, tests, source manifests, research documentation, branch inventory and open PR metadata. Main remains at that SHA. PR #17 is draft/unmerged at `68e1ce1b7a944d21a5c266ef87e10eb923fe9747`. PR #28 is draft/unmerged at `1bca2bdb6e3a9c53b15021a63242e26055e285d2`, based on #17. The experiment is an additive change targeting the latter commit. Other research branches were inventoried; unrelated stock/UI code was not modified or audited.

Private git cloning lacked CLI credentials; the GitHub connector supplied the pinned research files. Public source datasets were downloaded without provider credits. No database access, recorded-bet modification, website change, remote branch push, PR creation, merge, deployment or betting activation occurred. Delivery is an additive patch/package so it cannot trigger hosting automation.

The original source is `jacobburdier05/nba-moneyline-calibration` at commit `531580ab210ff8ffda25e58e89b5d08e2e8b85b5`:

- `data/raw/nba_moneylines.csv`, Git blob `ed143d6e608b21f791b7ff9f2e35577c9aa5997a`.
- `data/raw/nba_adv_crosscheck.csv`, Git blob `b68b299cdaa6aaa39e4b1c6ab2182d8eeeb23bf2`.
- 15,490 games; all 13 season counts match the source's stated coverage, including 990 in 2011–12, 1,229 in 2012–13 and 971 before the 2019–20 suspension.
- Independent parser checks home/away orientation, season dates, both IDs, duplicate fixtures, binary outcomes, and prices. Cross-extraction reconciliation matches 30,978 nonmissing team prices and 30,980 team outcomes, including date and season identity. Two missing side prices belong to one game.

These are two extractions of the **same upstream source**, not independent historical price verification. Hashes establish byte identity. They do not establish contemporaneous availability, bookmaker identity, market open/close status, corrections, stake limits or fills. Raw odds are separately licensed and are **not redistributed** in this deliverable.

## Reproduction results

PR #17: all eight ESPN/NBA Stats mirror assets exactly match the stored SHA-256 manifest. Reconciliation admits 4,920 games. The replay matches all 2,460 stored probabilities within 1e-12, outcomes, summary statistics, and the entire stored PR #17 JSON report. Its modern two-season legacy accuracy is 66.4634%, log loss 0.618327 and Brier 0.214219. The existing carry75 experiment still worsens 2023–24 validation slightly; its later improvement cannot erase that failure. Thirteen neutral-site games still receive the inherited H=65; this milestone does not alter those stored predictions.

PR #28: a separate parser, Elo implementation and Decimal payout calculation match all 8,351 evaluation probabilities within 1e-12 and both reported P&L totals, bet counts and win counts. The unmodified prior script also reproduces its own seeded intervals.

| Legacy cohort | Games | $10 bets | Net scenario P&L | Stake ROI | Day-end maximum drawdown |
|---|---:|---:|---:|---:|---:|
| 2013–14 through March 2020 | 8,351 | 6,442 | −$1,092.57 | −1.696% | $1,997.14 |
| Latest 5,000 archive games | 5,000 | 3,840 | +$247.68 | +0.645% | $1,435.61 |

The last-5,000 window starts **2016-03-01**, inside a season, and ends **2020-03-11**. It is not 5,000 bets or the most recent modern NBA seasons. Its $247.68 is on $38,400 cumulative stakes, not a return from a one-time $10 deposit. The full cohort stakes $64,420. Flat stakes assume sufficient funding; no starting-bankroll feasibility, concurrent exposure or ruin simulation is claimed.

PR #28 day-cluster 95% intervals reproduce as −5.378% to +2.299% (full) and −4.296% to +5.728% (last 5,000). The new week-cluster intervals are −5.052% to +1.781% and −3.956% to +5.118%. Different resampling units explain these differences. Season-cluster sensitivities are also saved; only 4–7 seasons exist, so they are fragile. None corrects prior exposure or model selection.

Always-favorite full-period P&L reproduces as −$3,709.36 on 8,350 bets. It is a descriptive strategy with different exposure, not a paired equal-stake superiority test. Matched-game probability comparisons are the meaningful market benchmark here.

## Frozen experimental design

`protocol.json` was written before running the new candidates, after inspection of the already exposed prior studies. This is a local prespecified comparison, not an independently timestamped historical preregistration.

1. Warmup: 2007–08, 1,230 games.
2. Calibration fitting: 2008–09 through 2012–13, 5,909 games. Each raw Elo feature is predicted before its day's outcomes; fitted calibration coefficients use only this training period.
3. Validation/selection: 2013–14 through 2015–16, 3,690 games.
4. Later **previously exposed temporal test**: 2016–17 through March 2020, 4,661 games. Not the overlapping last-5,000 display window.
5. Untouched test: reserved future 2026–27 regular season; no result or success claim.

Baseline parameters stay K=20, H=65, initial rating 1500. Same-calendar-day forecasts all precede updates. Earlier test-day outcomes may update later test ratings, as in a sequential forecasting system; no test outcomes fit hyperparameters or calibration. Calendar-date batching prevents same-day outcome leakage, but missing final-score publication timestamps prevent proving real-time data availability. No injury, roster, rest, possession, current-season aggregate or later corrected statistic is invented.

Four candidates were fixed: franchise identity correction; identity plus .75 offseason carryover; identity plus training-only logistic recalibration; and identity plus both changes. Identity maps SEA→OKC, NJN→BKN, NOH→NOP preserve sporting roster continuity; CHA remains separate. The aliases are identifiers, not future outcome features.

Calibration is sigmoid(a + b logit(p)), fitted by penalized likelihood with fixed penalty 0.5*(a²+(b−1)²). No coefficient, penalty, K, H, carryover or betting threshold grid was searched. Fitted coefficients are saved. Calibration can adjust output home bias and probability scale; it is not a separately fitted dynamic home-advantage rating. Validation chooses lowest mean log loss including the legacy model, with baseline-first deterministic ties. No refitting follows selection. All candidates, failures and per-season results remain reported.

The selection rule stays maximum estimated EV ≥2% at the raw archived price, positive proportional no-vig gap, at most one $10 wager, and home-first ties. Selection does not consult the outcome.

## Candidate evidence

Lower log loss and Brier are better. All ROI columns below are **un-timestamped price scenarios**.

| Model | Validation log loss | Exposed test log loss | Test Brier | Test scenario ROI | Full-period scenario ROI |
|---|---:|---:|---:|---:|---:|
| legacy | 0.604088 | 0.624449 | 0.217412 | 0.655% | -1.696% |
| identity | 0.604111 | 0.624449 | 0.217412 | 0.655% | -1.775% |
| identity_carry75 | 0.600275 | 0.620588 | 0.215894 | 0.473% | -2.562% |
| identity_calibrated | 0.604002 | 0.623205 | 0.216979 | 0.278% | -2.067% |
| identity_carry75_calibrated | 0.601400 | 0.622201 | 0.216519 | 0.009% | -2.700% |

The selected carry75 candidate lowers later-test log loss by 0.003861 versus legacy; paired week-bootstrap interval [−0.005669, −0.001947]. On validation its difference is −0.003813, interval [−0.006756, −0.001431]. These are descriptive intervals after historical exposure and comparison of multiple candidates, not confirmatory significance or profit evidence.

On the identical 4,661 test games, market probabilities have log loss **0.600395**, Brier **0.206896**, and accuracy **67.389%**. The selected candidate has log loss **0.620588**, Brier **0.215894**, and accuracy **65.501%**. Candidate-minus-market log loss is +0.020193, interval [+0.014238, +0.025772]. Better calibration-bin ECE (candidate 0.008619 vs market 0.019066) does not overcome worse overall probability scores. ECE depends on bins and sparse tails; it does not alone establish predictive value.

Selected-candidate test scenario: 3,585 bets, 1,348 wins, +$169.65, +0.473% ROI; week interval [−4.276%, +6.075%], four-season interval [−3.567%, +4.978%]. Day-end maximum drawdown is $1,628.28. An assumed five-cent incremental cost per wager changes net to −$9.60 (−0.027% ROI). This is a sensitivity assumption, not an estimated actual fee/slippage. Vig is already included in raw-price payouts and is not subtracted again.

Across all 8,351 evaluation games, the selected candidate loses **$1,656.60 (−2.562%)**, worse than legacy −$1,092.57. Its season ROIs switch signs. The identity-only correction also worsens full-period P&L by $50.91; fixing an identity defect does not guarantee profit. Training-only calibration fails to improve on carry75; do not retune on these test outcomes.

## Weaknesses and interpretation

- **Selection-conditioned error is the main warning.** Legacy selects 77.14% of games; 4,308 of 6,442 positions are positive-moneyline longshots. Its average predicted bet EV is +30.42%, yet realized scenario ROI is −1.70%. The selected candidate still predicts +30.42% average EV in the later test but realizes +0.47%. Unconditional reliability bins can look good while probabilities on disagreements with the market are badly miscalibrated. Large apparent edges should not be treated as real opportunity.
- **The no-vig screen is redundant under this positive-overround rule.** If p*D−1≥0.02, then p>1/D. With overround S>1, the proportional no-vig probability is (1/D)/S<1/D. Therefore the extra positive no-vig gap does not independently validate a bet. No-vig probabilities are benchmarks, not attainable payout prices or known true probabilities.
- **Strength persistence is crude.** Legacy carries every rating indefinitely across offseasons and ignores roster changes. Fixed shrinkage improves old-period scoring but is not consistently validated across modern seasons. Abbreviation changes silently reset three teams; canonical mapping fixes continuity without claiming economic benefit.
- **Home advantage is fixed.** H=65 can drift across eras and should be zero at authenticated neutral venues in a separately reviewed model. The old archive lacks neutral-site flags. We do not guess them. Training-only intercept recalibration did not produce the best candidate.
- **Information set is sparse.** The priced archive used here contains outcomes, not score margins, possession efficiency or injury snapshots. No margin-of-victory/roster model can honestly be fitted from these fields alone. The modern source has scores and tipoff metadata but no matched historical prices. Combining unrelated cohorts would misstate returns.
- **Accounting is correct but limited.** Half-up cents rounding is not inherently conservative (−1600 at $10 yields 62.5 cents, rounded to 63). It matches the old study; no arithmetic discrepancy explains away the losses. Drawdown uses daily net settlement only, not invented intraday ordering, bankroll percentage or time-to-recovery.
- **Market timing and source limitations remain binding.** Even a clear historical score improvement cannot establish executable betting advantage without decision-time data. Both datasets were previously exposed; no fresh test was manufactured.

## Tests, reproducibility and failures

110 Python tests pass: the 99 inherited tests plus 11 added tests. New tests cover independent cents arithmetic, actual same-day/future-outcome mutation, frozen training coefficients and validation selection after future mutation, source-pin rejection, duplicate fixtures, identity continuity, season regression, paired sample alignment, outcome-independent selection, invalid prices and day-end drawdown. All synthetic fixtures are explicitly fictional.

The first new suite invocation used the wrong working directory and failed discovery; rerunning from the repository root passes. No statistical parameter was changed in response to results. Next.js/Node tests and website builds were not run because this additive Python research changes no application code and makes no deployment-readiness claim.

From a checkout of PR #28's pinned head, apply only this package's additive patch, then:

```bash
python research/nba_audit_20261012/reproduce.py --cache /path/to/private-source-cache --output /path/to/NEW-audit-output
```

The script fetches the two pinned public old-archive inputs and eight recent mirror assets, checks hashes, runs the Python suite, writes the new audit and replays PR #17 with full stored-report equality. Existing output paths are refused. Keep raw data outside the repository; upstream raw-data terms apply. Changed upstream bytes stop the process; do not update pins silently. Python 3.12 was used; the runner uses only the standard library.

For offline execution after downloading:

```bash
python -m unittest discover -s analytics -p 'test_*.py' -q
python analytics/nba_research_audit_20261012.py --source /path/nba_moneylines.csv --crosscheck /path/nba_adv_crosscheck.csv --output-dir /path/NEW-results
python analytics/nba_quant_audit.py --folder /path/recent-sources --output /path/NEW-pr17-report.json
```

## Integration handoff and next decision

Keep the production version, historical forecasts, recorded bets, and PRs #17/#28 unchanged. This module has no live adapter and is **not a drop-in promoted model**. It establishes offline evidence and stable formulas. Research artifacts can be reviewed without touching the site.

Before a later prospective study: pin one model/state artifact and canonical team map; review neutral venues and availability cutoffs; use only final scores received before the decision cutoff; archive the model probability and named bookmaker's exact quote/receipt times before tipoff; never fall back to retrospective consensus prices; record all eligible games, abstentions and failures. Compare against the same book/time market baseline on matched games. Freeze selection and settlement assumptions and retain unmatched/late cases in an exclusion log.

Review the reserved 2026–27 season only at its prespecified endpoint. Primary endpoint is paired market-relative log loss; Brier/reliability, fixed-rule net ROI, uncertainty and dollar drawdown are secondary. Any model/rule/eligibility change invalidates the original future holdout for that new version. No collection or betting process is activated here. The selected historical candidate is at most a shadow-research hypothesis; approval to integrate or activate has not been requested or assumed.

## Sources

- Pinned project PRs: https://github.com/ang87505-crypto/SportsEdge/pull/17 and https://github.com/ang87505-crypto/SportsEdge/pull/28.
- Archive provenance and limitations: https://github.com/jacobburdier05/nba-moneyline-calibration/tree/531580ab210ff8ffda25e58e89b5d08e2e8b85b5 . README and `src/verify_data.py` inspected; original publisher availability not independently re-audited.
- Fixed offseason shrinkage motivation, not an exact replication of its full model: https://fivethirtyeight.com/features/how-we-calculate-nba-elo-ratings/ . SportsEdge differs in home advantage, margins, playoff inclusion and mean reversion target.
- Calibration and proper-score distinctions: https://scikit-learn.org/1.4/modules/calibration.html . The implementation here is an explicitly specified standard-library optimizer, not scikit-learn.
- New Orleans rename: https://www.nba.com/pelicans/news/new-orleans-pelicans-officially-adopt-new-namesake . NOH becomes NOP in 2013.
- Nets relocation: https://www.nba.com/nets/news/brooklyn_nets_unveil_black_and_white_team_colors_and_logos_120430.html . NJN becomes BKN for 2012–13.
- Seattle/OKC continuity: https://www.nba.com/news/oklahoma-city-thunders-nba-championships . SEA becomes OKC for 2008–09.
