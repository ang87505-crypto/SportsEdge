# SportsEdge AI 2.0 — Phase 2 status (2026-11-13)

Research only. Nothing has been merged or deployed. No production model, pick rule, risk limit, stake, budget or trading schedule has changed. Production stays at `f014dd1`. #102 is untouched.

## State of each part

| Part | Built | Tested | Connected (real data) | Scheduled | Activated | Proven effective |
|---|---|---|---|---|---|---|
| Learning loop: forward evaluation, run history, budgets (#166) | yes | yes, 19 engine tests including lifecycle rehearsal | yes, run 43498350141 | no (dispatch only; cron written in a comment) | no | no |
| Real forward test: props-learn-v1 vs active model | yes | yes | yes: 144 paired frozen lines → INSUFFICIENT_DATA | no | shadow only | no (needs 500 lines / 14 dates / 50 games / 100 decisions) |
| SEC company facts collector (#167) | yes | yes, point-in-time tests | yes: 10/10 companies, 0 as-of leaks, run 43498666563 | no | no | n/a |
| OpenAlex / arXiv literature (hypothesis-only) | yes | yes | yes: 5/5 and 3/3 queries, 72 leads, 0 injection flags | no | no | n/a |
| Calendar-day rest fix (`ai2/rest-calendar-fix`, no PR) | yes | yes: 3 regression tests; frozen default proven unchanged | n/a | n/a | no | no |
| `/lab` forward progress, job history, why nothing qualifies | yes | yes (view tests) | reads recorded files only | n/a | not deployed | n/a |

## Lifecycle rehearsal

The rehearsal is `src/lib/lab/engine/lifecycle.test.mjs`. It uses labelled synthetic fixtures and runs offline in temp directories. Each case and its result:

| Case | Result |
|---|---|
| Insufficient sample | INSUFFICIENT_DATA |
| Challenger meets the production gate | READY_FOR_REVIEW (owner review; nothing promoted) |
| Repeat run on the same data | no change; the run is still recorded |
| Failing challenger | REJECTED; it is terminal and not re-evaluated |
| Stale challenger (stopped predicting) | FAILED |
| Every prediction made after lock | refused; there is no evidence |
| No data | no change |
| Malformed input (failed collection) | the run is marked FAILED and the registry is untouched |
| Budget exhausted | the run stops before any request is made |
| Duplicate or revised predictions | the first frozen prediction wins |

Static checks also confirm there is no write, order or promotion path.

## Notes

- The **XOM company facts** have only 32 facts. Its filings use tags outside the 8 parsed tags, so coverage is thin. **PG** and **CAT** have no `StockholdersEquity` tag. The quality report flags all three, and nothing was repaired.
- The **ticker list** is a current list. It is not survivorship-free and must not be used as a research universe.
- **Calendar rest** is opt-in (`matchupFeatures(..., 'calendar-v2')`). Using it means a new model version. props-learn-v1 stays on `elapsed-v1` so that its running forward test stays valid.

## Owner decisions after Monday 2026-11-16

1. **Weekly engine schedule.** To activate it, add the commented cron `23 12 * * 2` in `research-engine.yml`. To persist state, either pass `state_run_id` or approve `contents: write` to the research-data branch.
2. **Collection schedule.** Decide whether to schedule `research-intake.yml` and store its datasets on the research-data branch.
3. **Calendar-v2 rest.** Decide whether to adopt it in a new learn model version. It would be a new challenger with its own forward test.

## Handoff: what is not done

- **Stock inputs.** Point-in-time fundamentals are collectable and validated, but they are not yet joined to the stock replay. The next step is a v4 pre-registered family in `analytics/` that reads `CIK*.json` from the intake artifact and uses `asOf(filed < decision day)`. Corporate actions, delisted names and exposure-adjusted benchmarks remain open; v3 already measures exposure drag.
- **Player context for challengers.** The patterns are measured, but the flags are not yet challenger features: minutes volatility, role change, line gap and books disagreement. Measured so far: minutes CV 0.30–0.50 overconfident by +6.7 points; line gap ≥40% overconfident by +10.9 points.
- **Read-only chatbot interface.** `engineView()` and `SOURCE_REGISTER` are the pure data interfaces. There is no LLM.
- **Reliability.**
  - Done: request budgets, bounded retries, failed runs that never half-apply, a dedupe manifest, and artifacts kept for 30 days.
  - Not done: alerts on a missed engine run. The existing ops monitor does not watch these jobs yet.
