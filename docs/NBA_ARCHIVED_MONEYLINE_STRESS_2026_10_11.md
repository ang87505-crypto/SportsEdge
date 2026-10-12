# NBA archived-moneyline stress test (October 11, 2026)

## Purpose and limits

A frozen, reproducible historical profitability **scenario**, explicitly NOT verified sportsbook execution or a candidate model promotion. Code is additive on top of the unchanged PR #17 NBA quant audit. The 66.46% winner accuracy on the modern 2024–2026 games previously had no matched historical market odds. This new research uses OLDER historical games with a different data source to test whether basic Elo prediction accuracy necessarily produces profitable choices. Do not conflate the two cohorts.

## Provenance

- Historical consensus-moneyline archive: https://github.com/jacobburdier05/nba-moneyline-calibration (commit 531580ab210ff8ffda25e58e89b5d08e2e8b85b5), file data/raw/nba_moneylines.csv, pinned Git blob ed143d6e608b21f791b7ff9f2e35577c9aa5997a.
- Upstream raw odds originate from Sportsbook Reviews Online, through the accompanying Dotan (2020) UCLA thesis repository. The research repository's MIT code license **does not cover its raw odds data**. This PR does not redistribute raw odds or game-level derived odds.
- The archive supplies one consensus moneyline per team, but **not** market observation/publication time, precise sportsbook identity, or guarantee the line was accessible when a wager could be entered. A historical moneyline is not an executable available quote. The model cannot be demonstrated to have achieved actual financial profit on this data.
- Source data covers 15,490 recorded NBA regular-season games from October 2007 through March 2020. Missing moneylines and invalid overrounds are excluded from wagering but not from known game outcome/rating updates.
- Original historical period is already exposed and inspected. The 5,000-game subset is NOT untouched holdout evidence and must not be used to tune the strategy then declared independent.

## Fixed protocol — not selected after seeing results

- Elo: 1500 initially, K=20, +65 for home. Games sharing a date are predicted together, then all same-day results update Elo AFTER prediction. No offseason reset; no use of later scores for prior-day forecasts.
- Train/warm up on games 2007–2013; evaluate full regular seasons 2013–14 through March 2020.
- Treat each intact, positive-overround, at-most-25%-overround consensus two-way market as archived prices. Proportional no-vig normalization.
- For each game, choose at most ONE wager: estimated EV >=2%, model probability exceeds proportional no-vig market probability. Prefer the highest estimated EV, home if tied. Otherwise no bet.
- Each qualifying bet stakes a flat **virtual $10**; payouts calculated deterministically in INTEGER CENTS using half-up rounding. This is research accounting, not our production 1% bankroll policy. No injury/roster, price slippage, taxes, liquidity, bookmaker limit, account suspension or line acceptance adjustment.
- Always-bet-archived-favorite is a simple baseline for matching the archive; it is not a validated optimal benchmark.
- Report every season, all 8,351 evaluated games and last 5,000 evaluated games. Group day-cluster bootstrap uncertainty uses 2,000 seeded resamples to avoid pretending every game is independent.

## Initial audit outcomes — historical price scenario, not proven earnings

| Cohort | Evaluated games | Qualifying $10 positions | Net virtual return | ROI on stakes |
|---|---:|---:|---:|---:|
| All evaluated 2013–2020 | 8,351 | 6,442 | **−$1,092.57** | −1.696% |
| Latest 5,000 archived games (2016–2020) | 5,000 | 3,840 | **+$247.68** | +0.645% |

Full period's Elo winner accuracy in this older cohort: 5,510 / 8,351 = 65.98%.

Always-favorite comparison over full evaluation: 8,350 recorded positions, hypothetical P&L **−$3,709.36**, ROI −4.44%. The most recent 5,000-game favorite comparison hypothetically lost **$2,652.23**, ROI −5.30%.

Returns vary substantially across seasons; the small positive recent-subset ROI is **not robust evidence of a profitable selection algorithm**. Previously estimated day-cluster uncertainty spans negative and positive ROI; recompute from pinned file using the Python runner before displaying any confidence intervals as verified artifacts.

## New files (existing research untouched)

- analytics/nba_archived_moneyline_stress.py: pinned-source check, source parser, earlier-day Elo replay, strict candidate filter, exact $10 accounting, simple baseline and reproducible day-cluster uncertainty. Exclusively creates output JSON, does not overwrite research archives.
- analytics/test_nba_archived_moneyline_stress.py: synthetic chronology/pricing/replay tests; all synthetic prices and outcomes explicitly fictional.
- This document.

## Reproduction

Download the public research package's archived source file separately, after checking applicable usage terms. Pin the exact repository commit above, then run:

    python analytics/nba_archived_moneyline_stress.py --source /path/to/nba_moneylines.csv --output /path/to/NEW-report.json

The CLI verifies its exact Git blob SHA and the 8,351 game evaluation size. It never inserts bets, requests paid Odds API credits, changes NBA model version, or writes to the live database.

Unit tests:

    python -m unittest analytics.test_nba_archived_moneyline_stress -v
    python -m unittest discover -s analytics -p 'test_*.py' -q

## Decisions for the next Work/Astra session

1. Treat the older-period loss and high wager frequency as a reason to investigate whether model probabilities were miscalibrated relative to actual pregame markets. Do NOT seek the largest in-sample threshold or cherry-pick the 5,000-game positive subset.
2. Acquire legitimate timestamped, source-matched pregame market prices for a chronologically preregistered later holdout; compare against book's no-vig and realistic cost assumptions. If such data are unavailable, ROI remains unverified.
3. Develop one candidate change using a disjoint earlier calibration/train period, freeze it, and evaluate on untouched forward games rather than reusing this exposed sample as pristine validation.
4. Keep sports paper-bet runner disabled until true quote freshness, owner authorization, receipt idempotence, and independent source verification are proven.

Do not call the existing SportsEdge betting model profitable on this test.
