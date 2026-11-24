# Learning engine and safety controls: fail-closed audit (2026-11-24)

**Scope:** whether the learning engine and the props safety controls detect deteriorating performance, missing
evidence, stale inputs and excessive confidence, and whether each control fails closed. Every claim below is backed by
a test in `src/lib/lab/engine/fail-closed.test.mjs` (6 tests) or `scripts/ops-monitor.test.mjs`, on synthetic data.

No model, promotion gate, sample minimum, brake threshold, schedule or production pick rule changed. Two defects
were fixed: one in the engine's lifecycle application, and one in how brake failures are reported.

## Findings

| # | Area | Result | Change |
|---|---|---|---|
| 1 | **Lifecycle, PROPOSED experiments** | **Defect.** `nextStatus()` can ask a `PROPOSED` experiment to move to `INSUFFICIENT_DATA`, `PROMISING` or `READY_FOR_REVIEW`, but the lifecycle only allows `PROPOSED → RUNNING/REJECTED/FAILED`. `transition()` threw `ILLEGAL_TRANSITION_PROPOSED_TO_*`, so the whole engine run failed and reverted, for every experiment. Reproduced on main through the documented `--result` path. Any seeded `PROPOSED` experiment with a forward spec would block every later run the same way. It failed closed, but it stopped all learning-registry progress | **Fixed:** `advance()` in `experiments.ts` records `PROPOSED → RUNNING` ("evaluation started") and then the outcome. It stays idempotent per input fingerprint. Terminal and illegal moves still throw: `REJECTED` never returns, and nothing skips owner review. `scripts/research-engine.ts` uses it in both places |
| 2 | **Safety brake visibility** | **Gap.** The brake runs inside every completed settle as best-effort, and its errors are swallowed (`summary.safetyBrake={error}`). The operations monitor never read it, so a brake that could not run was invisible while settles stayed green. That is a silent fail-open of a protective control | **Fixed (reporting only):** the monitor reads `safetyBrake` from the latest completed settle. A missing, errored or malformed receipt raises the blocker `props-safety-brake-unverified` while control is RUNNING. The monitor never pauses or resumes anything |
| 3 | Missing evidence | **Fails closed.** Forward `PROMISING` without the registered sample stays `INSUFFICIENT_DATA`. Invalid counts (NaN, negative, fractional) fail the sample check. Retrospective evidence of any size stops at `PROMISING`. Only forward evidence that meets the minimums reaches `READY_FOR_REVIEW`, which still needs the owner | Tests only |
| 4 | Stale inputs | **Fails closed.** No candidate prediction, or none within `maxStaleDays`, gives `ERROR`, then `FAILED`, never evidence. Fresh but empty gives `NO_CLEAR_EFFECT`, then `INSUFFICIENT_DATA` | Tests only |
| 5 | Deteriorating performance | **Detected; review only.** `sportsDrift` flags a significantly worse recent Brier score or confidence gap: last 7 days against the previous 28, Holm-adjusted, with minimum effect sizes. Rows graded after "now" are excluded, and small windows return `COLLECTING`. Its reason text says the model and gates are unchanged | Tests only |
| 6 | Excessive confidence | **Was partially covered.** The pick rule skips sides above `maxSideProbability`; drift flags only a *rise* in the confidence gap; the scorecard reports the absolute gap descriptively. A model overconfident throughout was never flagged | **Added (follow-up):** `alarms.ts` (`sports-alarms-v1`) raises `OVERCONFIDENT` when the 60-day picked-side confidence gap's 95% game-clustered lower bound exceeds +3 points (needs ≥100 picks and ≥20 games), review only |
| 7 | Safety brake logic | **Fails closed.** It pauses only a RUNNING control and never resumes. It needs at least 50 unique graded picks. Duplicates count once. It trips only when the Wilson upper bound is below the 57.7% break-even | Tests only |
| 8 | Pick rule with non-finite probabilities | **Defence-in-depth note.** `decidePick` returns `recorded` (side `less`) when both probabilities are NaN, because each comparison with NaN is false. It is unreachable today: picks are decided on database-returned rows, and the `props_predictions` check constraint rejects NaN and null probabilities for scored rows. `src/lib/props/rules.ts` is a frozen `props-paper-v1` file | **Not changed** (frozen production file). Recommend a reviewed change adding `Number.isFinite` guards when the next props release is planned |
| 9 | Failed engine run | **Fails closed.** Any exception reloads the input registry before writing, so a run never half-applies changes (existing lifecycle tests) | — |

## Verification

| Suite | Result |
|---|---|
| `src/lib/lab/engine/fail-closed.test.mjs` | 6/6. On unmodified main, the end-to-end test fails with `ILLEGAL_TRANSITION_PROPOSED_TO_PROMISING` |
| Learning engine, brake, learn worker, ops monitor (`src/lib/lab/engine/*.test.mjs`, `src/lib/props/brake.test.mjs`, `src/lib/server/props-learn-worker.test.mjs`, `scripts/ops-monitor.test.mjs`) | 83/83 |
| ESLint on changed files | 0 errors, 0 warnings |

## Follow-up: absolute alarms and outcome coverage (same PR)

**Finding:** the engine's ledger reader keeps only validly graded baseline predictions. A line that never received an
outcome, or whose grade contradicts its own box-score actual, was skipped without being counted. When collection
or grading stopped, drift simply returned `COLLECTING`. So missing outcomes and stale data were invisible to the
engine.

**Change:**
- The reader now returns `coverage`: scored, locked, graded, overdue (36 h past lock with no result) and
  contradictory baseline lines, plus the newest prediction and grade times. Every scored line is counted.
- `sportsAlarms()` (`src/lib/lab/engine/alarms.ts`) adds `report.domains.sports.alarms` to every engine run. Each
  alarm uses fixed, versioned thresholds:

| Alarm | Rule (sports-alarms-v1) |
|---|---|
| `OVERCONFIDENT` | 60-day picked-side confidence − hit rate, game-clustered 95% lower bound > 0.03; needs ≥100 picks and ≥20 games |
| `ACCURACY_BELOW_BREAK_EVEN` | 30-day pick hit rate, Wilson upper 95% < 57.7%; needs ≥50 picks. Independent of the production brake |
| `MISSING_OUTCOMES` | ≥5 locked lines and >2% of locked lines with no result 36 h after lock |
| `CONTRADICTORY_GRADES` | any grade that disagrees with its own actual |
| `STALE_PREDICTIONS` / `STALE_OUTCOMES` | no new prediction, or no new grade, for 3 days while the ledger is active (a prediction in the last 14 days). Otherwise `IDLE`, never "fresh" |
| `PERFORMANCE_DETERIORATED` | the existing drift rule requests review |

**Review only.** No alarm changes the model, picks, gates, stakes, schedules or the safety brake. An end-to-end test
proves that no experiment status moves because of an alarm. Tests: `src/lib/lab/engine/alarms.test.mjs`, 6 cases.
