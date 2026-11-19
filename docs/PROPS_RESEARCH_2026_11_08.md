# NBA props research and ranked paper picks

The original player-prop model and its paper entries remain frozen. A new
`/paper-betting/props-research` page ranks the active model's qualifying picks,
identifies their actual paper-entry IDs, and separately compares a confidence
calibration candidate. The sidebar links directly to it.

## What runs automatically

- The existing props worker remains the only process that selects and records
  actual paper entries. Its release conditions, owner controls, selection band,
  account limits and provider budget are unchanged.
- The new page reads the ledger on request and refreshes once a minute while
  visible. A current shortlist requires RUNNING control, a valid archived
  pre-lock prediction, more than ten minutes until lock, and a quote no more than
  two hours old. It does not turn an expired quote into a current opportunity.
- `NBA props research receipts` records a read-only snapshot at 15:45, 19:25 and
  22:25 UTC daily (8:45 AM, 12:25 PM and 3:25 PM Mountain Standard Time). It reads
  existing observations and grades, requests no additional odds, writes no ledger
  rows, and uploads its receipt for 90 days. Schedules begin only after this
  workflow is on the default branch. A green verify job or merge is not evidence
  that a snapshot has run; inspect the `snapshot` job and JSON artifact.
- This reporter runs in GitHub Actions and the page runs on Vercel; neither uses
  a ChatGPT/Claude subscription or a model API. Existing GitHub/Vercel/database
  availability and quotas remain dependencies. Missed collections or settlements
  stay missing or pending; the reporter cannot repair them by inventing data.

The reporter receives the same host-pinned Supabase configuration as the props
worker, but its data adapter exposes only SELECT. Secret-bearing jobs cannot run
from PRs or non-main manual dispatches. PR verification uses synthetic tests
without credentials. Neither original release PR #99 nor stock release PR #102
is edited or re-pinned by this work.

## Registered candidate

Protocol: `research/props_calibration_20261108/protocol.json`.
Candidate: `props-temperature-v2`.

Hypothesis: probability overconfidence can be reduced without changing the
forecasted side. The candidate scales conditional More/Less log odds toward zero
and preserves the explicit tie probability. It uses the original frozen model's
archived forecasts, not a new forecast fitted after seeing a result.

The five allowed temperatures are 1, 1.25, 1.5, 2 and 3. Each stat chooses only
on its January 2026 calibration log loss. The registered future comparison starts
November 8, 2026 at 19:00 UTC; the protocol, parameters and code must be committed
before that point. This is a probability-quality experiment; it does not promote
a candidate or establish that any particular wager has positive expected value.

Method reference: Guo et al. (2017), [On Calibration of Modern Neural Networks](https://proceedings.mlr.press/v70/guo17a.html).
Applying this calibration technique to these count forecasts is our research
hypothesis, not a claim that the paper demonstrated a sports-betting edge.

## Historical result

Inputs are the existing SportsDataverse ESPN NBA player box-score CSVs, regular
season only, with exact hashes pinned in the protocol. Prior rates use 2024-25.
Dispersion is refit on 2025-26 games through December 31, 2025. Each subsequent
forecast uses only games strictly before that game's tipoff. January 2026 chooses
temperature; February and later games provide retrospective confirmation.

| Measure | Original | Calibrated candidate |
| --- | --- | --- |
| Confirmation stat forecasts | 30,789 | Same 30,789 |
| Confirmation games | 506 | Same 506 |
| Brier score | 0.238896 | 0.237505 |
| Log loss | 0.673220 | 0.667657 |

Lower probability scores are better. The paired, game-clustered 95% bootstrap
interval for candidate minus original Brier is approximately -0.002074 to
-0.000682. Temperatures selected: points 3, rebounds 1.25, assists 1. This modest
improvement does not itself meet the separately registered forward review margin.
The transformation preserves the More/Less side, so its directional hit rate is
unchanged on identical lines; the subset passing the confidence band can differ.

These are 30,789 player/stat forecasts, not 30,789 independent games or bets.
The thresholds are proxies: floor(median of ten previous played games) + 0.5.
They are not archived platform lines, and no monetary return is calculated.
The earlier baseline study already exposed aggregate results on this season.
This confirmation is therefore **retrospective**, not an untouched holdout.
The full-season frozen forward model also has later-fitted prior/dispersion
parameters than the chronological historical replay. Transfer of calibration
to that deployed model must be checked prospectively.

Reproduction (Node 24; no npm install or paid API needed):

```bash
curl -fL https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/player_box_2025.csv -o /tmp/player_box_2025.csv
curl -fL https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/player_box_2026.csv -o /tmp/player_box_2026.csv
node --experimental-strip-types scripts/props-calibration-study.ts \
  --prior /tmp/player_box_2025.csv --season /tmp/player_box_2026.csv \
  --out /tmp/props-calibration-reproduction
```

The script rejects a changed source hash. Its complete report and frozen candidate
are committed under `research/props_calibration_20261108/`; the page uses the same
candidate copied to `src/data/props/research_v2.json`. The original model artifact
is fingerprinted so an unreviewed baseline change refuses the research snapshot.

## Prospective comparison and review gate

Within the displayed rolling 90-day window, use the first valid pre-lock forecast
for each exact event/athlete/stat/line, deduplicated across platforms and refreshed
quotes. Only observations captured at or after the registered forward start count.
Use the latest final result revision; ungraded results remain pending. A DNP is
void. An integer-line tie is an explicit class in probability scores and is
excluded from directional hit rate. Brier is the multiclass sum divided by two,
which equals ordinary binary Brier for half-point lines.

Review requires all of:

- 500 graded unique lines across 14 New York NBA slate dates and 50 games.
- 100 graded, non-tie candidate decisions under the existing confidence band.
- Candidate-minus-original Brier's paired, game-clustered 95% upper confidence
  bound below -0.002 (1,000 bootstrap replicates, fixed seed 20261108).
- No worse candidate log loss.

Passing only sets `ready_for_review`. Model promotion stays disabled. This gate
does not establish a betting edge or replace future testing against actual
platform lines and known payouts. Pick6 monetary returns remain unknown.

Deferred hypotheses are timestamped injury/lineup information, playing-time/role
changes, and opponent/pace/rest effects. They require separate source coverage
and chronological validation before they can influence the frozen experiment.

## Verification

```bash
node --experimental-strip-types --test src/lib/props/*.test.mjs src/lib/server/props-research-data.test.mjs
npm run lint
npm run build
```

Tests cover tie-preserving calibration, proper scores, same-line pairing and
deduplication, timestamps, latest corrections, stale/locked/paused refusal,
game-level uncertainty, review-only gates, artifact fingerprints and bounded
read-only pagination. A saturated snapshot fails rather than silently reporting
partial evidence. Database schema and original worker code are unchanged.

The existing disposable SQL fixtures also backdate their synthetic v1 budget
policy to January 1, 2026, before the pinned November test clock. Otherwise the
policy's real schema-load timestamp becomes invisible to yesterday's test clock.
This is the same test-only correction already reviewed on #99; no production
policy, budget value, assertion or release head is changed.
