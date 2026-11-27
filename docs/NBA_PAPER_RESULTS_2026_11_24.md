# NBA October 30 paper batch: results recorded November 24, 2026

Verified at 2026-11-24T18:51:03.375834+00:00. Repository inspected at main `ebffeb95b7e360380d4ca2c372a7856227ca7084`.

This supplements [the original run journal](NBA_PAPER_RUN_2026_10_30.md). That journal is a historical record and remains unchanged.

## Scope and model

Account: `nba-elo-research-v1`, account 2. Model: `nba-elo-k20-h65-2026-04-v1`, with April 13 ratings frozen. Source revision: `3329d0dc07b1d88e9c4cd2761ad81538f43026faaf3fa5366f3d714258beec41`.

The five positions were placed on October 30 at 07:05:36 UTC. They were already in the ledger when this verification began. Their final results had not been recorded. This work added results and settlements; it created zero forecasts or positions and made no model, stake, schedule, release, or STOP changes. Results were recorded at their actual November 24 retrieval/settlement time.

The separate fixed-$10 account `nba-elo-100x10-v1` still has zero positions. This older moneyline cohort is separate from the newer NBA player-props workflow.

## Source verification

The NBA October 30 games page's embedded data and ESPN scoreboard independently agreed on final status, home/away identities, and all scores below. The existing fixture checks and pregame forecast timestamps matched those identities.

- [NBA games, October 30](https://www.nba.com/games?date=2026-10-30)
- [ESPN scoreboard, October 30](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261030&limit=100)

All nine archived October 30 forecasts received final results, including the four games without positions.

| Game ID | Away @ home | Final, away–home | ESPN event | NBA game |
| --- | --- | --- | --- | --- |
| 19 | Charlotte @ Washington | 79–95 | 401909277 | 0022600015 |
| 20 | Chicago @ Boston | 111–125 | 401909278 | 0022600016 |
| 21 | Detroit @ Brooklyn | 110–94 | 401909279 | 0022600017 |
| 22 | New York @ Philadelphia | 93–98 | 401909280 | 0022600018 |
| 23 | Orlando @ Toronto | 121–114 | 401909281 | 0022600019 |
| 24 | Houston @ Dallas | 111–116 | 401909283 | 0022600021 |
| 25 | Indiana @ Miami | 125–145 | 401909282 | 0022600020 |
| 27 | Denver @ Phoenix | 127–120 | 401909286 | 0022600024 |
| 28 | Los Angeles Lakers @ Golden State | 95–112 | 401909285 | 0022600023 |

## Paper settlements

| Position | Selection | Stake | American odds | Outcome | Net paper profit |
| --- | --- | ---: | ---: | --- | ---: |
| 5 | Charlotte Hornets | $10.10 | +104 | Lost | −$10.10 |
| 6 | Orlando Magic | $10.00 | +182 | Won | +$18.20 |
| 7 | Los Angeles Lakers | $9.90 | −130 | Lost | −$9.90 |
| 8 | Detroit Pistons | $9.80 | −282 | Won | +$3.48 |
| 9 | Miami Heat | $9.70 | −278 | Won | +$3.49 |
| **Batch** | **3 wins, 2 losses** | **$49.50** | | | **+$5.17** |

The first three positions were already settled at +$10.33. The full account now has **5 wins, 3 losses, +$15.50 net paper profit, $1,015.50 virtual equity, and zero open positions**. Its observed bet win rate is 62.5% across eight bets.

For all nine October 30 game forecasts, the model's higher-probability side won **4/9**; mean Brier score was **0.2800516047953775**. This measures all archived forecasts, whereas the table measures selected wagers. Neither sample establishes long-run accuracy or profitability. The original 66.5% historical claim used daily-updating ratings and is not validated by this frozen model's paper results.

## Verification and accounting

The existing `research_record_result` and `research_settle` functions appended nine immutable final results and five settlements in one transaction. Guards required exactly the five expected open positions, verified fixture/model identity, no other open positions, and an expected net settlement of 517 cents. Any mismatch would have rolled back the transaction.

An independent Python Decimal calculation used whole-cent stakes and half-up rounding, matching the existing PostgreSQL settlement mathematics. The transaction's stored results were then reread and compared with the pre-write snapshot:

- All 12 forecasts were identical.
- All eight positions, including their original odds, stakes and timestamps, were identical.
- The three earlier settlements were identical.
- Exactly nine final results and five settlements were added.
- New settlement profit was 517 cents; total account profit was 1,550 cents.
- The fixed-$10 cohort remained empty.

No application code or schema changed. No provider odds refresh was requested.

## Stock handoff correction, read-only

Current main's `src/lib/stocks/paper-auto-release.ts` has scheduled runs enabled and broker writes disabled. The separate one-order manifest remains disabled. These observations describe the inspected main commit.

The [latest inspected stock execute run](https://github.com/ang87505-crypto/SportsEdge/actions/runs/45461718972), November 24 at 18:38 UTC (11:38 a.m. MST), completed with `NO_EXECUTABLE_DECISION_TODAY`, zero order posts and zero cancellations. A successful workflow conclusion alone does not demonstrate trading.

The [recorded weekly backtest](STOCK_WEEKLY_BACKTEST_ROUND2_RESULTS_2026_11_01.md) completed and produced trades/returns. Its preregistered verdict was `BELOW_SPY` for every variant. In that report, failure means failure to meet the performance gate; it is not a technical error or a zero-trade result. This review changed no stock setting.
