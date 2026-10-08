# SportsEdge NBA Model Track — deterministic foundation

Status on 2026-10-08: **implementation/test fixtures only. No sourced NBA results, trained/fitted parameters, or measured NBA model accuracy. No verified paper ROI.** This module has no network calls, API tokens, database mutations, or new dependencies.

## Files and isolation

- analytics/nba_elo_walkforward.py — separate NBA-only baseline; does not import soccer research code or mutate Supabase.
- analytics/test_nba_elo_walkforward.py — fully synthetic input fixtures (not actual NBA games), testing chronology, probability validity, source-schema strictness, and model comparison.
- Existing soccer research and its 579-match retrospective study are **unchanged**. Do not reinterpret soccer metrics as NBA results.
- Existing GitHub "Verify SportsEdge" workflow discovers all test_*.py files, including these new tests. No existing file edits are necessary.

## Data contract before any real evaluation

Require a separate, independently verified, licensed or properly reusable dataset of completed NBA **regular-season** games with stable team IDs, event IDs, timezone-aware scheduled tipoff, final scores (including overtime), and durable source provenance. The input file must contain:

| JSON field | Expected value |
| --- | --- |
| competition | literal nba |
| source | nonempty declared provider/source reference |
| source_revision | nonempty revision or snapshot identifier (must later be audited independently) |
| games | nonempty array of finalized fixtures |
| games[].game_id | unique stable provider event identifier |
| games[].starts_at | ISO 8601 timestamp with timezone offset / Z |
| games[].home_team_id, games[].away_team_id | distinct stable provider team identifiers |
| games[].home_score, games[].away_score | nonnegative full-time **integer** scores, unequal |
| games[].status | literal final |
| games[].season_type | literal regular |

The parser fails closed if any row is incomplete or non-regular-season, if a score is tied/negative/boolean, if duplicate IDs/fixtures are present, or if timestamps lack timezones. It rejects preseason and playoffs, preventing silent cross-population comparison. Source **strings** are stored as declarations, not independently authenticated: result_source_independently_verified remains false until an external audit is performed.

## Model protocol

- Two outcome classes only: home win vs away win (NBA final games cannot end in ties).
- Fixed, *untuned candidate* hyperparameters: initial Elo 1500, K-factor 20, +65 Elo home advantage (not estimated from NBA outcomes), probability clipping 1e-6.
- All fixtures sharing one **UTC calendar date** receive forecasts from ratings calculated using only games from **earlier UTC dates**. Ratings update after the entire calendar day's predictions are generated. This conservative chronological restriction avoids using a result from a later-finished game to influence an earlier prediction; it does not prove as-of availability of scores from delayed feeds or corrected results.
- Training covers only scores strictly **before** --start. Default training minimum: 30 prior regular-season games, a structural guard rather than an adequate statistical sample guarantee.
- Held-out dates --start through --end are evaluated walk-forward. Scores from a completed earlier evaluation day may update Elo before a subsequent day; hyperparameters and the comparator remain fixed.
- Benchmark: Laplace-smoothed pre-period home-win frequency, (training_home_wins + 1) / (training_games + 2), fixed for the entire evaluation period.
- Report binary Brier, log loss, and 0.5-threshold classification accuracy for model and baseline, alongside sample size and game-by-game probabilities.
- Output explicitly labels all forecasts **retrospectively reconstructed**. They were not timestamp-logged before historical games. There are no archived pregame sportsbook prices; no return/ROI, betting edge, model profit, or wagering recommendations can be inferred.

## Run after a real, verified data snapshot is available

~~~sh
python analytics/nba_elo_walkforward.py --input path/to/verified_nba_regular_season_results.json --start YYYY-MM-DD --end YYYY-MM-DD --output nba_audit.json
~~~

Replace the dates with actual held-out UTC dates. The program **refuses to overwrite** an existing --output file to preserve prior audits. It does not automatically download or invent any dataset. Run deterministic tests without input data:

~~~sh
python -m unittest discover -s analytics -p 'test_*.py' -v
~~~

## Next gates and explicit limitations

1. License and independently inspect real final NBA game results with stable IDs and season type; reconcile to Supabase game keys. NBA data has not yet been ingested, and the protected production connection test is still outstanding.
2. Pin source revision and publish an immutable input manifest (hash, provider, dates, records included/excluded); verify score time availability where possible, and reject missing/provider-ambiguous games.
3. Pre-register holdout window and hyperparameters **before** inspecting target results. Evaluate per-season/per-month calibration and uncertainty, plus no-vig sportsbook benchmark if verified historical odds become available. Do not optimize on the held-out sample.
4. Implement *forward* pregame prediction publication with server timestamp, model version, source snapshot, immutable predicted probability, and a later independent settlement event. Retrospective calculations alone are not forward validation.
5. Require sufficient out-of-time samples and correct market-priced edges before considering any paper betting performance. No model here is shown profitable.

## Primary references

- Python datetime timezone-aware vs naive objects: https://docs.python.org/3/library/datetime.html
- Time-ordered vs shuffled validation and leakage considerations: https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split
