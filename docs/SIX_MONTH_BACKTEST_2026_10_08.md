# SportsEdge — six-month backtest audit (2026-10-08)

**Status:** retrospective reconstructed test. NOT predictions originally recorded before games. NOT a strategy performance, ROI, profitability, or sportsbook validation claim.

## Scope and verifiable sources

- Requested retrospective window: 2026-04-08 to 2026-10-07 (inclusive).
- Source: OpenFootball/football.json, released under CC0-1.0 (public domain): https://github.com/openfootball/football.json
- Pinned repository revision: `e6744429ee395bc86f247348c6184bb08d4eb361` (2026-09-22).
- Last completed match supplied by this pinned snapshot: **2026-09-20**. October matches are NOT included. The reported coverage is a *subset* of the requested six-month window.
- Five competitions: Premier League, Bundesliga, La Liga, Serie A, Ligue 1.
- 15 league-season JSON files from 2024-25, 2025-26, 2026-27. File blob identifiers are included in `src/data/research/elo_2026_10_08.json`.
- Completed matches only, based on integer full-time score; fixtures without results are excluded.
- **Historical training:** 3,154 matches before 2026-04-08.
- **Evaluation:** 579 completed matches from 2026-04-10 through 2026-09-20.

## Fixed model and walk-forward protocol

- Simple Elo update K=20, initial unseen teams 1500, home advantage +65 Elo points.
- Home-vs-away conditional win probability: `1 / (1 + 10 ** (-(EloHome + 65 - EloAway) / 400))`.
- Fixed draw probability within each league, estimated from games **before** 2026-04-08, not from the evaluation window.
- Three-class probabilities: `P(H) = (1 - pDraw) * q`, `P(D) = pDraw`, `P(A) = (1 - pDraw) * (1 - q)`.
- Predictions for all matches on a date are calculated before using **any** result from that same date; ratings updated afterward.
- Hyperparameters are stated as a candidate configuration, not tuned on or selected from this test period.
- No team efficiency, injuries, pitching, bookmaker prices, or model-generated historical pick logs are used.

## Outcomes

| Metric | Elo reconstructed model | Pre-period league-frequency baseline |
| --- | ---: | ---: |
| Top-one accuracy (home/draw/away) | 49.91% | 43.18% |
| Log loss (lower better) | 1.0220 | 1.0765 |
| Multiclass Brier sum (lower better) | 0.6113 | 0.6514 |
| Games | 579 | 579 |

Individual model hit rates:

- Premier League: 56/121 = 46.28%.
- Bundesliga: 46/90 = 51.11%.
- La Liga: 74/149 = 49.66%.
- Serie A: 65/120 = 54.17%.
- Ligue 1: 48/99 = 48.48%.

Overall: **289 correct / 579**. Benchmark: **250 / 579**.

Interpretation: initial model improves predictive metrics over an uninformed pre-window baseline on this retrospective sample, but bookmaker odds often offer much stronger baselines. No guarantee of out-of-sample future accuracy, economic advantage, or profitability. The snapshot source does not include timestamped historic odds.

## Reproduction and tests

- Core reproducible script: `analytics/elo_walkforward.py`.
- Optional local output: `python analytics/elo_walkforward.py --output backtest.json`.
- Input pinned by revision: `e6744429ee395bc86f247348c6184bb08d4eb361`; the script downloads only those public JSON files on execution.
- Offline tests: `python -m unittest discover -s analytics -p 'test_*.py'`.
- Frozen auditable output and each game's predicted probabilities and actual result: `src/data/research/elo_2026_10_08.json`.
- The research web page is `/research/backtest` after CI passes and the branch is merged and successfully deployed.
- Require next step to compare against actual archived pregame market implied probabilities and a forward-logged holdout period.

## Known limitations and project state

- Current source snapshot is stale relative to 2026-10-08; avoid presenting this as live, all-season, or comprehensive October coverage.
- Possible data entry errors have not been independently validated against league governing bodies.
- Same-day grouping reduces, but does not solve, all possible event-time ambiguities.
- Training and evaluation use a single fixed model; a statistically better probability score does not establish betting profitability.
- **SportsEdge Supabase still has zero stored games and odds.** No automatic ingestion was enabled or claimed.
- **Vercel's production builds are failing.** Work is in a separate branch pending CI verification.
- Existing files were not replaced.
