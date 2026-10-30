# NBA prospective paper run — October 30, 2026

Scope: shared virtual account `nba-elo-research-v1` (account 2). The separate
`nba-elo-100x10-v1` account and stock experiments are untouched.

## Model identity

The trial retains `nba-elo-k20-h65-2026-04-v1`, with ratings frozen as of April
13, 2026. More paper bets measure this deployed baseline. They do not validate
the roughly 66.5% historical accuracy of the daily-updating Elo implementation.
The cadence mismatch is documented in `NBA_MODEL_V2_RESEARCH_2026_10_20.md`.
No model parameters, ratings or selection thresholds were changed in this run.

## Operational repair and checks

PR #90 restored the missing `/api/internal/research-cycle` endpoint, using the
existing single-use, ten-minute DB-issued capability and request-budget RPCs.
It creates no wagers or schedules. Next.js and eslint-config-next were patched
from 16.4.0 to 16.4.3. All five PR workflows passed; local validation was 234
JavaScript tests passed, 30 skipped, zero failures; production build passed;
lint had zero errors and three pre-existing warnings.

Production deployment: `dpl_Ay8336SS1FM16wk9vW5PZLaCE2Zy`, commit
`476bec417a04a746e87c116c0800f0c26c8007db`.

Probe run 2 completed and verified a server-side connection with nine sport rows.
Refresh run 3 completed at 2026-10-30T06:40:31.921832Z, inserting 198 NBA
and 423 EPL quote snapshots. The NBA feed contained 15 games. The provider
reported 495 requests remaining. EPL quotes were collected by the existing
dual-track collector; no EPL position was created.

## Fixture identity and start-time reconciliation

The NBA October 30 schedule and ESPN scoreboard agreed on the ten scheduled
fixtures below. The Odds API stored nominal tipoff ten minutes later for these
games. Only future fixtures without a published forecast or prior fixture check
were corrected to the independently verified, earlier official start. Earlier
cutoffs avoid treating the interval after the official start as pregame.

Sources:

- https://www.nba.com/games?date=2026-10-30
- https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261030&limit=100

| Away | Home | Verified start (UTC) | ESPN event |
| --- | --- | --- | --- |
| Charlotte Hornets | Washington Wizards | 2026-10-30T23:00Z | 401909277 |
| Chicago Bulls | Boston Celtics | 2026-10-30T23:30Z | 401909278 |
| Detroit Pistons | Brooklyn Nets | 2026-10-30T23:30Z | 401909279 |
| New York Knicks | Philadelphia 76ers | 2026-10-30T23:30Z | 401909280 |
| Orlando Magic | Toronto Raptors | 2026-10-30T23:30Z | 401909281 |
| Indiana Pacers | Miami Heat | 2026-10-31T00:00Z | 401909282 |
| Houston Rockets | Dallas Mavericks | 2026-10-31T00:00Z | 401909283 |
| LA Clippers | Minnesota Timberwolves | 2026-10-31T00:00Z | 401909284 |
| Los Angeles Lakers | Golden State Warriors | 2026-10-31T02:00Z | 401909285 |
| Denver Nuggets | Phoenix Suns | 2026-10-31T02:00Z | 401909286 |

Nine fixtures (game IDs 19–25, 27, 28) were reconciled and received immutable
forecast IDs 5–13, published at 2026-10-30T06:45:07Z. The Clippers fixture
was skipped: the provider uses `Los Angeles Clippers`, while the frozen model
maps `LA Clippers`; the strict mapping was preserved.

## Original three positions

NBA and ESPN final scores independently agreed:

| Position | Pick | Stake | Odds | Outcome | Paper profit |
| --- | --- | ---: | ---: | --- | ---: |
| 2 | Detroit Pistons | $10.00 | -118 | Won | +$8.47 |
| 3 | New York Knicks | $9.90 | -184 | Lost | -$9.90 |
| 4 | Oklahoma City Thunder | $9.80 | +120 | Won | +$11.76 |

These immutable results and settlements were recorded with the existing RPCs
on 2026-10-30T06:53:27Z. Total paper profit is $10.33; virtual equity is
$1,010.33 before any new outcomes. The Thunder game had a later ESPN event
timestamp (01:50Z) than its original scheduled 01:30Z start. Its identity and
final score were manually reconciled against the official NBA schedule/results;
the original forecast, bet timestamp and scheduled cutoff were preserved.

Result sources:

- https://www.nba.com/schedule?cal=all&pd=false&region=1&season=Regular+Season
- https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261020&limit=100

## Next bounded batch

At most five unique NBA games, frozen model, model EV >= 2%, positive no-vig
edge, one percent of available virtual cash, whole integer cents. Final
placement uses `research_place_current(..., 60)`, requiring observed and
ingested quote timestamps within sixty seconds and a complete current
two-way market. Candidate selection is recomputed from fresh data.

The first snapshot expired during start-time reconciliation. The existing
25-minute dispatch cooldown was preserved; the next eligible refresh is
2026-10-30T07:05:02.410893Z. No quote timestamp is backdated or renewed
without another actual provider observation.

Refresh run 4 completed at 2026-10-30T07:05:33.454839Z. It inserted another
198 NBA and 423 EPL snapshots; the provider reported 493 requests remaining.
Four requests were reserved across the two explicit refreshes, within the
eight-request rolling-day cap. Both probes and market refreshes placed zero
positions themselves.

The owner-requested bounded batch then recorded and independently reread these
five virtual positions at 2026-10-30T07:05:36Z:

| Position | Game | Pick | Stake | American odds | Source book | Quote ID |
| --- | --- | --- | ---: | ---: | --- | ---: |
| 5 | Charlotte Hornets @ Washington Wizards | Charlotte Hornets | $10.10 | +104 | lowvig | 1340 |
| 6 | Orlando Magic @ Toronto Raptors | Orlando Magic | $10.00 | +182 | lowvig | 1414 |
| 7 | Los Angeles Lakers @ Golden State Warriors | Los Angeles Lakers | $9.90 | -130 | draftkings | 1496 |
| 8 | Detroit Pistons @ Brooklyn Nets | Detroit Pistons | $9.80 | -282 | lowvig | 1376 |
| 9 | Indiana Pacers @ Miami Heat | Miami Heat | $9.70 | -278 | draftkings | 1441 |

Every selected quote was observed at 2026-10-30T07:04:57Z and ingested before
placement. The placement-age range was 39.493–39.506 seconds. Forecasts were
published before the quotes and before tipoff. Receipt verification checked
account, forecast, quote, selection, odds, model version, chronology, source,
quote age, integer-cent stakes and the sequential 1% available-cash calculation.

Post-run virtual equity: $1010.33. Pending exposure: $49.50.
Available virtual cash: $960.83. Settled record: 2 wins, 1 loss.
All five new outcomes remain pending. The separate fixed-$10 NBA cohort still
has zero entries; no real sportsbook orders or ongoing wager schedules were enabled.

These are simulations using recorded source prices. Executable sportsbook
availability and long-run profitability have not been established.

## Related stock status (read-only review)

Claude's separate `stock-v2-weekly-1` run log (PR #89, head
`79b31d8c437efee7955162283268e9c3aa438285`) labels the 136-stock weekly
variant untested. It changes cadence, universe and price admission while using
the same scoring mathematics. The recorded registration state is STOPPED.
Current main has `brokerWritesEnabled: false` and `scheduledRunsEnabled: false`
in `src/lib/stocks/paper-auto-release.ts`; its worker and weekly-decision
workflows are manual-dispatch only. Activation later in the session is a plan,
not verified execution. This NBA run changes no stock algorithm, experiment
gate, broker setting or workflow release switch.

