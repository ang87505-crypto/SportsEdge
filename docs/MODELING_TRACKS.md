# SportsEdge separate model tracks

**Keep NBA and soccer as separate, independently evaluated modeling programs.** They share secure ingestion, timestamp validation and odds storage; they never share Elo ratings, labels, injury features, outcomes or model accuracy claims.

## NBA track (`nba`)

- Odds ingestion provider key: `basketball_nba`. Current first milestone: upcoming American-odds moneylines, US region only.
- No NBA prediction model has been trained or backtested yet.
- Future results source: licensed/verifiable NBA completed results, reconciled to provider events. Exclude preseason when evaluating regular season unless explicitly stratified.
- First model candidate: separate NBA Elo ratings with home advantage and time-ordered calibration. Candidate features after verified sourcing: team efficiency, rest, opponent strength, roster/injuries by as-of timestamp.
- Metrics: binary winner log loss, Brier, calibration, held-out chronological accuracy, comparison to bookmaker no-vig estimates. Do not claim ROI without archived executable prices.

## Soccer track (`soccer`)

- New first-milestone odds collector maps exclusively to **English Premier League** (`soccer_epl`).
- Historical research already exists in `analytics/elo_walkforward.py` with **579 retrospectively reconstructed results** spanning five leagues; not an automated EPL live model. Keep those results separate from production odds ingestion.
- First modeling improvement candidates: EPL-focused Elo benchmark, Poisson expected goals with prior-only goal data, then market baseline/ensemble if independent holdouts support it.
- Metrics: three-way home/draw/away log loss, multiclass Brier, calibration, bookmaker no-vig probability comparisons. A US sportsbook may provide no three-way odds; do not convert a two-way soccer market into a win/draw/win market.
- EPL selection is intentionally independent of the existing site's **MLS** tab, which is not changed in this milestone.

## Model publication gates

1. Identity, timestamp, result and competition quality checks pass.
2. A prediction is saved **before kickoff** with immutable model version + published probability.
3. Outcomes from a verified results provider are reconciled to the exact game.
4. Chronological baseline comparisons and calibration tables are generated, alongside sample sizes.
5. Paper ROI is computed only using contemporaneously captured, valid pregame sportsbook prices; historical examples are not real betting picks.
6. Publish only verified results and explicit uncertainty; never assert profitability from a backtest alone.
