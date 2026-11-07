# NBA player-prop paper testing: PrizePicks and DraftKings Pick6 (2026-11-07)

Status: **implemented and locally verified; not yet connected or running.** No
genuine line, prediction, entry or settlement exists yet. Scheduled runs are
released OFF in source (`src/lib/props/schedule.ts`), and the ledger schema has
not been applied to any Supabase project.

The daily cycle is collect, validate, predict, record picks and entries before
lock, collect final box scores, grade, reconcile, and show the results on the
dashboard (`/paper-betting/props`).

Virtual entries only. Nothing contacts a DFS account, submits an entry, scrapes a
private endpoint or moves money. Account eligibility is not proof that paid
contests are lawful for any person or state (the owner is 19, in New Mexico).

## Scope and what was reused

| Kept unchanged | Why |
| --- | --- |
| NBA moneyline experiment (`nba-elo-k20-h65-2026-04-v1`, `research_*` tables, `nba-elo-research-v1` account) | Immutable forecasts/results stay identifiable; props never read or write them |
| `odds-collector.ts`, `normalize.ts`, research-cycle and its 8/day, 240/30-day budget | Working NBA/EPL h2h refresh; props budget coordinates via a provider-credit floor instead |
| Stock algorithms, broker permissions, accounts, release switches | Out of scope |

Patterns reused: PostgREST host-pinned store with secret-free error codes
(`paper-auto-store.ts`). GitHub Actions worker with a release switch OFF in
source and a single concurrency group (`paper-auto-worker.yml`). Append-only
audit triggers and integer cents (`research_*`). Emerald UI kit, evidence labels
and stacked mobile ledger tables.

New (additive) pieces:

| Area | Files |
| --- | --- |
| Contract, normalizer, budget | `src/lib/props/{contract,normalize,budget}.ts` |
| Model, identity, box scores, rules | `src/lib/props/{model,identity,boxscore,rules}.ts`, `src/data/props/model_v1.json` |
| Ledger schema (separate `props_*` tables and RPCs) | `database/props/props_v1.sql`, tests in `database/props/tests/` |
| Worker and adapters | `src/lib/server/props-{store,odds-client,espn-client,cycle}.ts`, `scripts/props-worker.ts` |
| Schedule and workflows | `src/lib/props/schedule.ts`, `.github/workflows/props-daily.yml`, `.github/workflows/props-verify.yml` |
| Dashboard | `src/app/paper-betting/props/page.tsx`, `src/lib/props/dashboard-view.ts`, `src/lib/server/props-dashboard.ts` |
| Evaluation | `scripts/props-model-fit.ts`, `research/props_baseline_20261107/evaluation.json` |

## Data access (verified 2026-11-07)

The Odds API, read on its documentation pages:

- **Bookmaker list:** region `us_dfs` includes `prizepicks` (PrizePicks) and `pick6` (DraftKings Pick6).
  - PrizePicks: "Demons and goblins are included under _alternate markets … Goblins have been assigned the default odds, demons have been assigned even odds (+100)."
  - Pick6: "Selections with non-default multipliers (not x1) are included in _alternate markets."
- **Markets:** `player_points`, `player_rebounds`, `player_assists` (Over/Under; `description` = player, `point` = line).
- **Endpoint:** `GET /v4/sports/basketball_nba/events/{eventId}/odds` with `regions=us_dfs&bookmakers=prizepicks,pick6&markets=player_points,player_rebounds,player_assists&oddsFormat=american&includeMultipliers=true`.
- **Cost:** `cost = [number of unique markets returned] x [number of regions specified]`, so at most 3 credits per event. The events list is counted as 1 credit (conservative).
- **Usage headers:** `x-requests-remaining`, `x-requests-used`, `x-requests-last`.

What has not been verified:

- **Plan and DFS coverage.** The plan size and whether DFS coverage is included on it are unverified. On 2026-10-30 the provider reported 493 remaining, consistent with a 500/month plan. The first real request is the coverage test.
- **Live calls from this session.** This session had no `ODDS_API_KEY` or Supabase credentials. Its egress proxy also refused `the-odds-api.com` and `site.api.espn.com`. So **no real collection was demonstrated**.

### Budget (enforced in the database, reserved before every call, never refunded)

| Policy `props-budget-v1` | Value |
| --- | --- |
| Rolling 24 h | 12 credits |
| Rolling 30 days | 200 credits (existing refresh cap 240 + 200 = 440 ≤ 500) |
| Provider floor | Stop when `x-requests-remaining - cost < 60`, protecting the existing NBA/EPL refresh |
| Per run | At most 3 events, earliest tip-off first, 10 h horizon, nothing within 20 min of lock |

In practice this prices about 3 games a day (1 + 3 x 3 = 10 credits). A bigger,
already-authorized plan can raise the caps by inserting a new
`props_budget_policy` row in a reviewed change. Nothing here buys data or
upgrades a plan.

### Stored evidence

Every provider reply is stored with its SHA-256 content hash (`props_raw_responses`).

Every admitted line (`props_observations`) records:

- provider, platform and bookmaker key
- event id and teams
- stat, `full_game` period, line
- both sides' indicative prices and multipliers
- provider `last_update`
- our `ingested_at`
- commence time and lock (the earlier of the listed and returned start)
- the original outcome fields
- the response hash

Rejected inputs are counted by reason: stale, future, after-lock, ambiguous (two
standard lines), incomplete pair, special multiplier, unknown book, alternate
market, mismatched event.

Database triggers refuse:

- writes from a run that is not live
- lines at or after lock, or older than 2 h
- predictions or picks at or after lock
- any update or delete of evidence

A fixture flag cannot be true.

### Player logs and box scores

- **Historical data.** SportsDataverse `espn_nba_player_boxscores` (CC BY 4.0):
  - 2024-25 `player_box_2025.csv`, sha256 `8e34c5b1…e4f7`
  - 2025-26 `player_box_2026.csv`, sha256 `7a4868da…cc89`
  - The mirror had no 2026-27 file (last asset written 2026-09-09).
- **Current season and grading.** ESPN's public `scoreboard`/`summary` JSON, the source production already uses for moneyline settlement.
  - It is undocumented and has **no published licence**. That rights gap is a recorded limitation.
  - Field names were verified against a real summary: `keys` include `minutes`, `points`, `rebounds`, `assists`; DNP rows have `didNotPlay: true` and empty `stats`.
- **Missing values stay missing.** A played row missing any graded stat is rejected, never zero-filled.

## Model `props-nb-minutes-rate-v1` (frozen)

The model treats a stat, conditional on the player appearing, as negative
binomial with mean = expected minutes x per-minute rate. Its components:

- **Expected minutes:** recency-weighted (half-life 4 games, last 10 played).
- **Rate:** recency-weighted (half-life 8, last 20) and shrunk with 120 minutes of prior weight. The prior is the player's previous-season rate if he logged at least 300 minutes, else the league rate.
- **Variance:** μ + μ²/k_stat + rate² × Var(minutes). This carries changing playing time into the spread.
- **Outliers:** appearances under 6 minutes are excluded as injury exits or garbage time.
- **Unscorable:** fewer than 3 current-season played games, last game more than 21 days ago, a missing stat, or an unresolved identity.
- **Data excluded:** no injury, lineup or opponent data is used or invented.
- **Outputs:** P(More), P(Less) and P(Tie) for integer lines.

Hyperparameters were fixed before evaluation. Only the league rates (prior
season) and NB dispersion (training window) were estimated. The forward artifact
`src/data/props/model_v1.json` was fit on 2025-26:

- dispersion: points 8.54, rebounds 23.65, assists 24.29
- 582 player priors

### Chronological evaluation (2025-26, `research/props_baseline_20261107/evaluation.json`)

Walk-forward, per player-game, using history strictly before tip-off
(10,909 leakage checks). Dispersion was fit on games through 2026-01-31; the
scores below cover later games only (n = 10,263 per stat).

No historical DFS lines were purchased. The threshold is therefore a **proxy
line**: floor(median of the last 10 played games) + 0.5.

| Stat | Model Brier / log loss | Season-mean Poisson | Last-10 Poisson | Model mean −log pmf vs best baseline |
| --- | --- | --- | --- | --- |
| Points | **0.2466 / 0.694** | 0.2768 / 0.812 | 0.2498 / 0.697 | **3.20** vs 3.94 |
| Rebounds | **0.2367 / 0.667** | 0.2453 / 0.690 | 0.2411 / 0.676 | **2.21** vs 2.31 |
| Assists | **0.2335 / 0.659** | 0.2416 / 0.684 | 0.2393 / 0.674 | **1.83** vs 1.91 |

The model beats both simple baselines on every proper score. **It is
overconfident in the tails**: points predictions binned at about 0.94 were right
only 0.66 of the time.

Proxy lines are not platform lines. DFS lines are set by professional
projections, so these hit rates **do not indicate an edge** against PrizePicks or
Pick6. Profitability was not required and has not been shown.

Candidates for later comparison (at most two, not tuned now):

1. An autoregressive count model (INGARCH-style, Briz-Redón 2024)
2. Opponent, rest and home adjustments (Paul et al. 2020)

## Selection, entries and platform rules (`props-select-v1`, frozen before any forward result)

- **Every admitted line** gets a prediction (scored or unscorable) and a recorded decision (pick or skip with a reason). That covers both individual accuracy and calibration.
- **Pick rule:** record when the side probability is between 0.60 and 0.80 and tie probability is below 0.05.
  - 0.60 sits above the 2-pick 3x break-even of 0.577.
  - Above 0.80 is skipped as `extreme_disagreement`, given the measured overconfidence and likely missing information.
- **Entries:** 2 picks, each leg from a **different game and player**. This is the documented correlation restriction, since v1 has no joint model. It also avoids PrizePicks' same-game payout reductions and satisfies Pick6's two-team rule.
  - Greedy by probability; never forced to fill a quota.
  - Recorded at least 2 minutes before the earliest leg's lock.
  - $5.00 virtual stake, at most 3 entries per platform per New York day.
  - $500 virtual bankroll per platform.
  - Separate accounts `props-prizepicks-v1` and `props-pick6-v1`.
- **Grading:** from final box scores, overtime included.
  - DNP, or absence from a complete final box score: void.
  - Postponed or cancelled with no final within 36 h: void.
  - Ties: void (Pick6, "graded as a void"); one-tier revert on PrizePicks.
  - Corrections are appended as new revisions and flagged. Settled entries are not rewritten.
- **PrizePicks payouts** (`prizepicks-power-standard-20261107`, from https://www.prizepicks.com/help-center/payouts):
  - Power Play 2/3/4/5/6 picks = 3x/6x/10x/20x/37.5x.
  - A tie or DNP reverts the lineup one tier.
  - "2-Pick Power with 1 correct pick and 1 tie → 1.5X"; "with 1 losing pick and 1 tie → Loss"; both void: refund.
  - The page notes payouts can differ for same-game picks; state-specific variants are not modelled.
- **Pick6 payouts:** https://pick6.draftkings.com/pick6-prizes says "Base Payouts and prize multipliers vary by sport" and Extra Winnings depend on other entrants. The contest rules also split the pool among the most-correct entries when nobody wins.
  - No NBA base table is published, so **every Pick6 settlement records `payout_unknown`**.
  - Leg wins, losses and voids are still recorded.
  - Pick6 bankroll change is shown as not measurable. No competitor result is invented.

## Daily operation

| UTC | Kind | Purpose |
| --- | --- | --- |
| 09:20 | settle | Box scores for last night, grade, settle |
| 15:20 | settle | Late finals and stat corrections |
| 19:10 | collect | Lines for games tipping off within 10 h |
| 22:10 | collect | Remaining budget, if any |

Each run:

- is a durable `props_runs` row with a lease
- has one run per kind live at a time (`BUSY` otherwise)
- is idempotent per slot (`DUPLICATE`)

A crashed or cancelled run is closed as `abandoned` by the next start.
Pause/stop is checked before every paid call.

A late GitHub start keeps its original slot and records its delay. Games that
are now within the lock margin are skipped, never relabelled as pregame.
Provider calls are never retried; ESPN reads retry at most twice.

The run receipt reports counts **read back from the ledger**. A green workflow is
not proof that anything was recorded.

## Owner actions to go live (in order)

1. **Choose the project.** Use the research project (`fzyjazhvkstvwwzjhlrr`) or the staging project (`vfyzbliksooljxrlfadp`); the adapter accepts only these two hosts. Apply `database/props/props_v1.sql` in its SQL editor. It is additive, prefixed `props_*`, and starts **PAUSED**.
2. **Add GitHub Actions secrets:** `SPORTSEDGE_PROPS_SUPABASE_URL`, `SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY` and `ODDS_API_KEY` (the existing authorized key). Add the first two to Vercel for the dashboard.
3. **Check the connection.** Dispatch *NBA props paper cycle* with `status`.
4. **Resume:** dispatch `resume` with a reason.
5. **Backfill:** dispatch `backfill` with `from=2026-10-21`, `to=` yesterday (at most 25 dates per run). This builds current-season player logs; until then, every line is unscorable `insufficient_history`.
6. **Collect.** Dispatch `collect` on a game day before 21:00 UTC. Then check the run summary: plan, per-event `byPlatform` counts, rejections, usage, receipt. Confirm the dashboard shows PrizePicks and Pick6 rows. **This is the real coverage test.**
7. **Settle.** After the games, dispatch `settle` and check the graded and settled counts.
8. **Release the schedule.** Only after steps 6–7 look right: set `scheduledRunsEnabled: true` in `src/lib/props/schedule.ts` in a reviewed commit.

Rollback: set the switch back to false, or dispatch `pause`/`stop`. The ledger is
append-only, so nothing needs deleting. There is no other props schedule, so no
duplicate active schedule exists.

## Verification run in this session

- `node --experimental-strip-types --test src/lib/props/*.test.mjs`: 29 pass.
- `bash scripts/verify-props-sql.sh` (as root on local PostgreSQL 16):
  - `PROPS_V1_SQL_TESTS_PASS`
  - the end-to-end test passes: backfill, a 3-h-late collect, both platforms, 72 lines, entries across distinct games, the duplicate slot, budget exhaustion, a DNP, settlement in exact cents, Pick6 `payout_unknown`, a stat correction, and lease recovery.
- `npm run lint`: 0 errors. `npm run build`: passes.
- Local desktop (1366 px) and iPhone 13 checks of `/paper-betting/props`: no horizontal overflow. Checked both unconfigured ("Not connected yet") and with the synthetic integration database (a local-only preload hook, not committed).

## Literature (bounded review; abstracts only unless noted)

| Source | Method | Data required | Evaluation design | Limitations | Practical relevance |
| --- | --- | --- | --- | --- | --- |
| Czado, Gneiting & Held (2009), *Biometrics*, "Predictive model assessment for count data" (abstract) | Non-randomized PIT, marginal calibration, proper scores for counts | Count forecasts + outcomes | Methodological case studies | Not sports | Basis for log score / calibration checks of count stats |
| Gneiting, Balabdaoui & Raftery (2007), *JRSS-B*, "Probabilistic forecasts, calibration and sharpness" (abstract) | Maximize sharpness subject to calibration | Predictive distributions | Methodological | Not sports | Why calibration is reported beside accuracy |
| Briz-Redón (2024), *Applied Statistics* (2023 preprint), doubly self-exciting Poisson (INGARCH) for NBA scoring (abstract) | Autoregressive count time series, Bayesian | Game and minute-level field goals | Selected 2018-19 teams/players | Field goals not props; small selection | Research candidate 1 (temporal dependence) |
| Döpke, Köhler & Tegtmeier (2023), *J. Economics and Finance*, NBA fantasy projection evaluation (abstract) | Forecast-error tests vs naive | 1,658 provider projections, Feb 2022 | One month, four providers | Short window | Professional projections only modestly beat naive and are biased; sets expectations |
| Paul, Weinbach & Losak (2020), *J. Prediction Markets*, DFS salary efficiency (abstract) | Regression of performance on salary and factors | DFS salaries + box scores | Market-efficiency tests | Salaries, not pick'em lines | Research candidate 2 (home, rest, opponent) |
| Walsh & Joshi, "ML for sports betting: accuracy or calibration?" (arXiv; abstract) | Model selection by calibration vs accuracy | NBA games + odds | Backtest | Team markets; large ROI claims unreplicated | Supports calibration-based selection, not ROI expectations |
| Ziel (2021, arXiv preprint), M5 uncertainty: overdispersion and GAMLSS (abstract) | NB and other distributional forecasts | Retail counts | M5 competition | Not sports | Supports NB over Poisson for overdispersed counts |

Excluded: a 2026 "two-tier" NBA props ROI paper published by a betting company
(conflict of interest; unreplicated returns). Tools used: SciSpace and the
Firecrawl research index (abstracts), and Firecrawl page reads for the provider
and platform documentation. Context7 failed to connect, and the Consensus and
OpenAlex connectors were not available. Seeing the same paper in several search
tools is not treated as independent confirmation.

## Release and budget v2 (owner-approved 2026-11-07; merge only after a verified real cycle)

Setup verified by the owner on 2026-11-06 (America/Denver):

- `props_v1.sql` is applied on staging (`vfyzbliksooljxrlfadp`), and the secrets are set.
- Control is RUNNING.
- [Backfill](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42329922101) saved 3,271 player-game rows; 1 incomplete summary was skipped.
- The [first collect](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42332792446) listed 13 upcoming events and priced none. Two were within the lock margin and 11 were beyond the horizon, so it did not test DFS coverage.

This release changes:

- `src/lib/props/schedule.ts`: `scheduledRunsEnabled: true`, with the same four UTC slots.
  - The 22:10 collect is kept as a no-spend fallback. The 24 h credit window is rolling, so a 19:10 run can be refused when the previous day's collect started late. When the day's credits are already used, the 22:10 run exits before any provider call.
- `src/lib/props/budget.ts` and `database/props/props_budget_v2.sql`: `props-budget-v2`.
  - 7 credits per rolling 24 h (event list 1 + 2 games x 3).
  - 200 per 30 days, floor 60, at most 2 games per collect.
  - About 200 a month alongside the moneyline refresh's 240, within a 500 quota whether or not the keys are shared.
  - The SQL row takes effect at 2026-11-08 16:00 UTC, so it can be applied before merging without affecting the first verified cycle.
- Unchanged: model `props-nb-minutes-rate-v1`, selection `props-select-v1`, pause/stop, idempotency, leases, append-only evidence, paper-only flags.

Owner steps:

1. Run `database/props/props_budget_v2.sql` in the staging SQL editor. It is re-runnable and prints the policy rows.
2. Merge the release PR after the Saturday collect and Sunday settle receipts are verified.
3. Rollback: set `scheduledRunsEnabled` back to false, or dispatch `pause`/`stop`.

## Two-season historical check (2026-11-07)

`scripts/props-model-fit.ts backtest` refits only the league per-minute rates and
NB dispersion, on the prior season alone. It then predicts every
regular-season player-game of the next season from strictly earlier games and
applies the frozen `props-select-v1` rule. No platform lines exist for this
period: historical DFS odds are paid-only and were not purchased. Lines are
proxies (recent median + 0.5), so there are **no dollar results**.

Outputs:

- full results: `research/props_backtest_20261107/backtest_{2024-25,2025-26}.json`
- compact summary for the site: `src/data/props/backtest_v1.json`
- prior-season source: 2023-24 file `player_box_2024.csv`, sha256 `c52a708a…9ae2`

| Season (prior) | Lines | Model Brier P/R/A | Best baseline P/R/A | Picks recorded (share) | Hit 0.60–0.65 / 0.65–0.70 / 0.70–0.80 | Skipped >0.80 hit |
| --- | --- | --- | --- | --- | --- | --- |
| 2024-25 (2023-24) | 70,137 | 0.2459 / 0.2367 / 0.2328 | 0.2489 / 0.2427 / 0.2367 | 32,600 (46%) | 60.7% / 65.1% / 69.5% | 69.3% of 3,044 |
| 2025-26 (2024-25) | 71,595 | 0.2463 / 0.2357 / 0.2313 | 0.2495 / 0.2418 / 0.2369 | 33,977 (47%) | 60.3% / 64.8% / 70.0% | 72.4% of 2,781 |

Both seasons agree. The model beats both simple baselines on every stat, and
hit rates in each confidence band match the stated confidence. Points remain
overconfident above about 0.80.

The frozen rule's >0.80 skip would have hit about 70% against proxy lines.
The rule is unchanged: it guards against injury and role news that move real
lines, and proxy lines do not capture that. Revisiting it is a candidate for a
future, separately versioned rule after forward data.

Proxy lines are easier than professional projections, so none of this is
evidence of profit on PrizePicks or Pick6.

The dashboard (`/paper-betting/props`) now shows:

- this historical check, with a per-stat calibration chart
- the daily cycle in UTC and New Mexico time
- the active budget

The moneyline paper page links to it.
