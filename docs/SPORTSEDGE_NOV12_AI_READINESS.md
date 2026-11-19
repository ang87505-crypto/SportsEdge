# SportsEdge AI readiness: Nov 12 completion sprint (written 2026-11-13 ~03:00 UTC)

Scope: `main` at `198b27f` (PR #156). Production serves `198b27f` (ops monitor, 14 of 14 live checks, 2026-11-13 00:35 UTC).
Every **VERIFIED** claim below names its evidence. Everything else is labelled for what it is. Passing tests show
that the code does what it says. They do **not** show that any prediction is profitable.

## 1. Executive summary

- **Sports PAPER is running unattended and its records hold up under audit.** The first paid event-aware capture
  happened on Nov 12 at 21:17 UTC (tick run 29, Vercel backup):
  - two games captured for 6 credits, both stored 173 and 233 minutes before tip;
  - 84 lines scored, 18 qualifying picks;
  - PrizePicks entries #16–#18 recorded before lock;
  - every budget, uniqueness and settlement check PASS.

  The ledger is append-only, guarded against post-lock writes, and independently re-graded from box scores.
- **The "zero profit despite a win/loss record" is correct arithmetic, not a defect.** PrizePicks v1 is 3 won and
  6 lost at a $5 2-pick Power Play (3×): 3 × +$10.00 + 6 × −$5.00 = $0.00. The new accounting identity in the
  ledger audit reports `IDENTITY_OK` on the real ledger for all four accounts. Pick6 shows $0.00 because its six
  entries have **unknown** payouts (no published NBA base table). They are deliberately excluded from profit and
  ROI, not counted as zero-return.
- **Learning Lab `NOT_MIGRATED` is expected.** `database/props/props_lab_v1.sql` (PR #153) is an owner step that
  has not been applied. Until it is, the research-only freeze step does nothing. It is `continue-on-error` and
  cannot affect the paper tick. Not a Monday blocker. Lab forward evidence (registered to start 2026-11-13) only
  begins once you apply it.
- **Monday's stock session is ready, apart from the steps only you can take.**
  - #102's pinned head `9e23e63` still differs from `main` in the stock execution path only by the write switch
    (and its matching comments/CI assertion, plus a kickoff refactor that only Vercel uses from `main`).
  - On that exact head, 69 of 69 controller, broker, risk, worker and owner tests pass against a real isolated
    Postgres schema and a fake broker, plus the Python bridge tests (run locally tonight).
  - Remaining: you press Start before the session, the decision must be TARGETS, and you press Stop then Start
    before the close.
- **No blocker found that threatens Monday's experiment validity.** The largest operational risk is GitHub dropping
  scheduled runs (props-tick: 26 of 33 slots missed in 7 days). The Vercel backups covered every capture that
  mattered on Nov 12.
- **Two Monday execute check-ins exist** (from two sessions, 14:35 and 14:38 UTC). The 14:38 one refuses to dispatch
  if any release-branch execute already ran that day, so no double order can result. Keep just one (§10).
- **Not built yet:** autonomous internet research, injury/lineup data, fundamentals data and intraday data.
  The design is in §7. Nothing was activated.

## 2. Verified capabilities (WORKING AND VERIFIED)

| Capability | Evidence |
|---|---|
| NBA props capture (event-aware ticks, 7/24 h, 200/30 d, floor 60) | Tick run 29 ([43308726133](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43308726133)): 2 captures `stored`, 6 credits, 42+42 DFS lines; preflight [43339012343](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43339012343): cap-held, claims unique, provider 470 ≥ 60, all PASS |
| Stats model `props-nb-minutes-rate-v1` scoring every valid pregame line | Run 29 receipt: 84 observations, 167 predictions (active + shadow `props-learn-v1`), 18 recorded picks |
| Pre-lock recording and immutability | `props_v1.sql`: chronology triggers refuse observations/predictions/picks at or after lock and results before lock; `props_append_only` on every ledger table; unique `entry_key`, run slot, claim; SQL suites pass (7 of 7) |
| Settlement and payout accounting | Ledger audits [43211189347](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43211189347) (entries #10–#15 VERIFIED against ESPN box scores) and [43354773074](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43354773074) (`ACCOUNTING … IDENTITY_OK`, all accounts) |
| Safety brake (pauses picking when the recent hit rate is confidently below the 57.7% break-even) | `brake.test.mjs`, `props-learn-worker.test.mjs` (pauses RUNNING once, never resumes) |
| Sportsbook comparison stored with each capture | Run 29: 206 book quotes (DraftKings 73, FanDuel 67, BetMGM 66) |
| Scheduler redundancy | Ops monitor: 3 of 11 Nov 12 ticks ran on GitHub's schedule, 7 came from Vercel backups (plus 1 manual); 21 Vercel crons |
| Duplicate/idempotency protection | Preflight: 0 duplicate runs, plans or claims; integration test "backup races, late arrivals… never repeat paid calls or entries" (9 of 9) |
| Stock research pipeline (registry, historical replays, forward ledgers) | `research-data/summary.json` 2026-11-12 04:43 UTC: NONE QUALIFIES; research-collect ran 2026-11-12 18:12 UTC |
| Stock controller safety (gate, lease, reconcile, risk limits, shadow mode) | 69 of 69 tests on #102 head `9e23e63` (local, real Postgres, fake broker) |
| Ask SportsEdge (deterministic, read-only; owner-gated stock data; Pause/Stop proposals need owner confirmation) | Production live checks 14 of 14 incl. owner protections and health briefing (ops monitor 00:35 UTC) |
| Owner protections | Live checks: anonymous chat gets no stock data; owner APIs return 401 without a session |

## 3. Missing or incomplete capabilities

| Capability | Status | Note |
|---|---|---|
| Learning Lab sports forward freeze (`lab-sports-ablation-v1`) | **BLOCKED (owner step)** | Apply `props_lab_v1.sql`; freeze reports `NOT_MIGRATED` until then |
| Variable-staking shadow ledger | **BLOCKED (same SQL)** | Research only; flat $5 stays live |
| Injury / lineup availability layer | **MISSING** | No free, timestamped pre-lock feed collected. Candidate: the NBA's official injury report (published PDFs); needs a terms review |
| Learning-model promotion end to end on real data | **IMPLEMENTED BUT NOT VERIFIED** | Gate coded and tested; no candidate has met 500 lines / 14 dates / 50 games yet; auto-switch off |
| Calibration challengers (`props-temperature-v2`, `props-gap-shrink-v1`) | **PARTIALLY IMPLEMENTED** (collecting) | Research only; far from their pre-registered sample |
| Expected value per pick | **PARTIALLY IMPLEMENTED** | Pick rule is a 60–80% confidence band; break-even 57.7% used by the brake; no per-pick EV display |
| Pick6 payouts | **BLOCKED BY EXTERNAL DEPENDENCY** | No published NBA base payout table; kept `payout_unknown` |
| NBA game-winner / soccer forward forecasts | **PARTIALLY IMPLEMENTED** | Retrospective studies verified; forward collection needs an external `research_dispatch` call and has no current schedule |
| Stock PAPER orders with real fills | **IMPLEMENTED BUT NOT VERIFIED** | Monday's supervised session is the verification |
| Stock monthly evaluation | **IMPLEMENTED BUT NOT VERIFIED** | First run 2026-12-03 |
| Stock behaviour ablation forward picks | **IMPLEMENTED BUT NOT VERIFIED** | First freeze expected on the research run after Friday's session (week of Nov 16) |
| Fundamentals research | **MISSING** | No fundamentals data source beyond 13F holdings |
| Intraday strategies | **BLOCKED BY EXTERNAL DEPENDENCY** | IEX-only free feed; no consolidated quotes (`docs/STOCK_SHORTER_HORIZON_REVIEW_2026_11_12.md`) |
| SEC Form 3/4/5 dataset | **BLOCKED BY EXTERNAL DEPENDENCY** | 2026 Q2/Q3 return 404 (not yet published); research-only source |
| Autonomous internet research | **MISSING** (design + inactive intake validator only) | §7 |
| Chat internet research / research actions | **MISSING** | By design: no LLM and no web tool in production |

## 4. Sports AI architecture

```
The Odds API (events free; event odds 3 credits/game) ──► capture plan (salted ranking, early/late windows)
ESPN public box scores ─────────────────────────────────► grading + player history
        │
        ▼
props_observations (pre-lock, append-only) ─► props_predictions: active model + shadows + (lab variants*)
        │                                        └─► market views (sportsbook consensus, line gap)
        ▼
pick rule (props-select-v1: 60–80% band) ─► props_picks ─► entries (≤3/platform/day, distinct games, $5 flat)
        │
        ▼
settle (09:20/15:20 UTC + Vercel 10:00/16:00) ─► props_line_results ─► settlements (PrizePicks terms v1; Pick6 unknown)
        │
        ▼
weekly learn (Sun) ─► challengers (shadow ≤3) ─► promotion gate (500/14/50, Brier CI) ─► owner approval (auto-switch off)
research: temperature-v2, gap-shrink-v1 (forward), lab ablation (9 variants*), staking research*   (* needs props_lab_v1.sql)
```

The production prediction path, the research challengers and the lab are separate. Research and lab code can read
the ledger, but only the pick rule writes picks, and only the entry builder writes entries. Nothing in research
or the lab can call either.

## 5. Stocks AI architecture

```
Alpaca PAPER (IEX bars, account, orders) ─► weekly decision (Mon 08:00 ET; Vercel 09:00 UTC kickoff + GitHub 11:20 UTC)
                                            └─► stock-v2-weekly-1: mom252-skip21-trend200 (frozen)
owner gate (Start/Stop/Pause) ─► controller (lease, reconcile, risk limits, same-session decision, shadow when writes OFF)
                                 ─► intents ─► fills ─► daily after-close mark (verified/contaminated chain) ─► SPY comparison
research (research-data branch): registry → historical replays (costs 10/25 bps, exposure-matched SPY, holdouts)
  → forward ledgers: QMOM follower, Berkshire 13F (45-day lag), momentum-quality, daily ×3, turn-of-month,
    behaviour ablation (frozen weekly picks)  — all challengers, none active
```

Copying an investor's holdings is treated as a delayed, survivorship-prone signal. The Berkshire follower uses
filing dates, not period ends. QMOM uses the fund's own daily disclosures, forward only. Neither is assumed to
reproduce the source's returns.

## 6. Conversational command center architecture

- **Understanding:** deterministic intent and domain routing (`src/lib/assistant/understand.ts`, `domain.ts`), with
  follow-up context. No AI service, no per-question cost.
- **Data tools (read-only):**
  - props ledger;
  - operations monitor (`ops-status/status.json`);
  - research summary;
  - lab views;
  - owner-only stock ledger and broker snapshot, read only with a validated owner session.
- **Shared read model:** `src/lib/briefing/*` (Overview and chat answer from the same code).
- **Actions:** proposals only (`src/lib/assistant/actions.ts`): Pause/Resume/Stop props and Pause/Stop stocks.
  The UI's Confirm button calls the existing owner endpoint. Stock Start, orders, budgets and promotion are never
  available. Replies say "Nothing has changed yet" until the endpoint confirms.
- **Shared tool interface (documented contract):** each system exposes read models only, through
  `src/lib/server/*-load*.ts` loaders returning typed views (`Raw`, `OpsView`, `ResearchView`, `PaperAutoLedger`,
  lab views). Chat never imports a writer. New tools must follow the same pattern (typed loader, fail closed,
  "unavailable is not zero").
- **Not present:** internet search and research initiation from chat (§7 keeps these off-path).

## 7. Autonomous internet research design (free-first; NOT activated)

**Goal:** find documented, evidence-backed methods, turn them into testable hypotheses, test them on SportsEdge's own
data, and remember failures, without paid AI subscriptions and without touching active models.

| Stage | What | Free sources / tools | Runs where |
|---|---|---|---|
| R0 Discover | Fixed, versioned query lists by domain | OpenAlex API, arXiv API, Crossref, Semantic Scholar (free tier); SEC EDGAR submissions and full-text search (fair-access User-Agent); fund disclosure pages already in `registry.json` | GitHub Actions weekly; append to `research-data` branch JSONL |
| R1 Card | Each lead becomes a `HypothesisCard` (rule, inputs + when known, holding period, baseline, costs, sources, bias review) | Deterministic templates; an optional LLM extractor stays **off by default**, needs owner approval and a hard monthly cost cap, and is never required | Same job |
| R2 Intake gate | `assessIntake` (built tonight, `src/lib/research/intake.ts`): stable duplicate key; already-rejected check against the registry; refuses look-ahead inputs and paid-only data; requires every bias answer; scores source credibility | — | Pure function |
| R3 Pre-register | A doc committed **before** any run (rule, data, split, gate), as for every existing study | Git history = timestamp | PR |
| R4 Historical test | Existing engines: props retrospective (proxy lines, labelled as such); `analytics/research` replays with 10/25 bps, exposure-matched SPY, untouched holdout | Own data only | Manual or monthly workflow |
| R5 Forward | Challenger ledger (append-only, frozen before decision) | Existing forward ledgers | Nightly |
| R6 Decide | Pass → candidate for the existing promotion path (gate + owner). Fail → registry status `rejected` with its `intakeKey`, so R2 refuses it forever | — | Registry PR |

**Credibility rubric** (`credibility()`; the best source decides):
- Base weights: primary filing 1.0; fund disclosure or audited record 0.9; peer-reviewed 0.8; working paper 0.6;
  practitioner write-up 0.4; self-reported claim 0.2; social media 0.1; marketing 0.
- Halved if the author sells a product tied to the claim.
- Capped at 0.3 if the claimed performance cannot be verified from public records.
- A low score allows an exploratory test only. **A claim is never evidence; only SportsEdge's own pre-registered
  test is.**

**Bias controls (required fields on every card):**
- survivorship (point-in-time universes, delisted names);
- selection (who was chosen and when, before seeing results);
- disclosure delay (13F 45 days, Form 4 2 days, fund disclosures daily);
- transaction costs (10/25 bps stocks; platform payout tables for props);
- data snooping (one pre-registered rule per card; Holm correction across a family).

**API spending:**
- Discovery sources are free.
- The Odds API is never used for research beyond what the paper capture already pays for.
- Research reads the stored `props_*` and research-data records.
- Duplicate keys stop repeat work before any request.

**Tonight:** the design and the intake validator, with 5 tests. No job, no schedule, no network call, and no path
to any model, rule, stake or schedule.

## 8. Free infrastructure and API budget analysis

| Service | Use | Limit / cost | Status |
|---|---|---|---|
| The Odds API | Props capture (3 credits/game; events list free) | Policy 7 per rolling 24 h, 200 per 30 d, floor 60; provider reports 470 remaining; 35 used in 30 days | VERIFIED (preflight). Provider plan size and reset date are not in our records; check the provider dashboard |
| ESPN public JSON | Box scores, schedules | Unofficial, no SLA, free | Working; a format change would stall grading (results stay pending, never invented) |
| Alpaca PAPER | Orders, account, IEX bars | Free | Read-only checks verified; orders from Monday |
| SEC EDGAR | 13F, company tickers | Free; ≤10 requests/s with User-Agent | Working |
| OpenFIGI | CUSIP mapping | Free, 25 requests/min | Working |
| GitHub Actions | All workers and research | Free tier; schedules unreliable (props-tick 26 of 33 slots missed in 7 d) | Working with Vercel backups |
| Vercel | Website, 21 daily crons as backups/kickoffs | Current plan; each cron runs at most once a day | Working |
| Supabase | Props ledger; staging (stock PAPER ledger); research | Free-tier limits not re-verified tonight | Working |

Additional monthly cost tonight: **$0**. Nothing paid was activated.

## 9. Model and forward-testing integrity assessment

| Item | Finding | Evidence |
|---|---|---|
| Active versions | Props: `props-nb-minutes-rate-v1` (stats), selection `props-select-v1`; shadow `props-learn-v1`. Stocks: `stock-mom252-skip21-trend200-v1` (`stock-v2-weekly-1`) | Run 29 summary; ledger parser regex |
| Prediction timestamps / inputs | Observations carry provider update and ingestion times; predictions store `inputs`; lab rows store `data_cutoff`, `predicted_at` and a database-computed hash | `props_v1.sql`, `props_lab_v1.sql` |
| Freeze mechanisms | Model artifact hash checked against the research artifact (`RESEARCH_BASELINE_ARTIFACT_CHANGED`); lab spec SHA-256 registered; stock experiment `configDigest` | `scripts/props-research-snapshot.ts`, `AI_LEARNING_LAB` doc |
| Immutable records | Append-only triggers on every props and lab table; stock ledger fail-closed parser | SQL tests |
| Duplicate prevention | Unique slot/claim/entry keys; one running run per kind; lease for stock runs | Preflight 0 duplicates; controller tests |
| Settlement accounting | Correct; identity holds | §1, audit [43354773074](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43354773074) |
| Leakage | Writes refused at or after lock; lab retrospective reports 0 violations in 92.8 M input checks; research cards refuse post-decision inputs | `props_v1.sql`, lab report |
| Scheduler reliability | GitHub schedules unreliable; Vercel backups and the ops monitor cover them. Gap: Vercel backups are every 2 hours, so a capture window shorter than about 2 h depends on GitHub firing | Ops status 00:35 UTC |
| Production vs research separation | Lab and research write only `props_lab_*` and the `research-data` branch; tick lab step is `continue-on-error` | Code review tonight |
| Experiment-validity risk found | **None blocking.** Recommendation: a merge freeze from Sunday 18:00 UTC until the Monday mark (four PRs merged on Nov 12 changed production mid-experiment, though none touched pick or stake rules) | — |

## 10. Monday readiness blockers

These items depend on you or on Monday's data. No code blocker was found.

1. **Owner Start (ARM) before about 7:30 AM MT.** Start also runs the fresh account check the gate needs within 26 hours.
2. **The weekly decision must be TARGETS.** A HOLD means no order day and the gate cannot pass. The release watcher
   window ends 2026-11-21; after that, you review and merge #102 by hand.
3. **Owner Stop, then Start, after the fills and before the 2:00 PM MT close.**
4. **Pick one Monday execute check-in.** Both are enabled:
   - `trig_018nhvJDxGeNoky49ZBthdTV` (this session, 14:38 UTC): at most once, refuses if another release
     execute ran today.
   - `trig_019yCBF3teLoxs5dK82vTLGi` (other session, 14:35 UTC): may redispatch on a skipped slot and then runs
     the release watcher.

   Recommendation: keep one. Tell me which to disable; I won't touch the other session's task without your say-so.
5. **Confirm you want the release watcher to merge #102 automatically once the gate passes** (the existing design),
   or say so if you'd rather merge it yourself.

## 11. Prioritized improvements

1. **(Owner, optional, before Friday's first lock about 23:00 UTC)** Apply `props_lab_v1.sql` so lab forward evidence
   starts on schedule. It is research only.
2. Ops monitor: mark a GitHub-missed slot "covered by backup" when a Vercel run landed in the same window, so
   `MISSED_SLOT` warnings reflect real gaps only.
3. Odds API plan facts (monthly allotment, reset day) recorded in the budget policy notes.
4. Injury-report feasibility study (terms review of the NBA official injury report; timestamps; parsing). Research only.
5. Research pipeline R0–R2 as a manual-dispatch workflow writing only to `research-data`, after owner review of this design.
6. Per-pick EV display (PrizePicks payout terms vs model probability), read-only.
7. Upgrade the GitHub Actions versions (Node 20 deprecation) and set the `package.json` module type.

## 12. Friday–Monday execution checklist

Times are UTC (MT = UTC−7). "Model-safe" means it can be done without changing any active model, rule or stake.

### Friday, November 13

| Check | How | Pass | Blocks Monday | Model-safe |
|---|---|---|---|---|
| Nov 12 entries #16–#18 settle | Settle 09:20 GitHub / 10:00 Vercel; then the preflight ledger audit (2026-11-12..13) | All legs graded from final box scores; AUDIT VERIFIED; `ACCOUNTING … IDENTITY_OK` | No | Yes |
| Payout accounting | Same audit | `IDENTITY_OK` on every account; Pick6 stays unknown | No | Yes |
| Model validation | `/paper-betting/predictions` and the props breakdown; research snapshot (`props-research.yml`) | Metrics reported with sample sizes; baseline artifact hash unchanged; nothing promoted | No | Yes |
| Calibration | Breakdown by confidence band; lab calibration error (retrospective) | Gap and 95% range reported; groups under 30 marked too small | No | Yes |
| Historical research | Research summary after the 02:17 run (and the Vercel 04:00 backup) | `generatedAt` is Friday; lab-historical stock ablation present; no candidate activated | No | Yes |
| Lab SQL (owner, optional) | Apply in the Supabase SQL editor, then watch the next tick's lab step | Freeze step reports rows written, not `NOT_MIGRATED` | No | Yes (research only) |

### Saturday, November 14

| Check | How | Pass | Blocks Monday | Model-safe |
|---|---|---|---|---|
| 48-hour capture review | Scheduled check-in 06:10 (`trig_014ynHuqjRrtoNrxP7h55wko`): preflight + ops monitor | 0 cap breaches; 0 duplicate or unresolved claims; captures before lock; settlements complete | No (sports) | Yes |
| Scheduler resilience | Ops monitor job table; count GitHub-missed vs Vercel-covered | Every required job has a success within its window; stock kickoff ran Friday 09:00 | Yes, if the stock kickoff or decision path is failing | Yes |
| Stock dry run | Controller tests on `9e23e63` (done tonight: 69 of 69); Friday's execute slots on `main` show `NO_EXECUTABLE_DECISION_TODAY` or a shadow plan | No failures; no intents reserved on `main` | Yes | Yes |
| Stock lab freeze | `research-data/lab/stock-forward-ledger.jsonl` gains the week-of-Nov-16 picks | Appended before Monday's open; never rewritten | No | Yes |

### Sunday, November 15

| Check | How | Pass | Blocks Monday | Model-safe |
|---|---|---|---|---|
| Weekly learning | `props-learn` 10:00 (Vercel backup 16:00) | Trains or `SKIPPED_RECENT_TRAIN`; no promotion (auto-switch off) | No | Yes (shadows only) |
| Experiment freeze | `/api/version` = `main`; #102 head = `9e23e63`; no merges after 18:00 | All three hold | Yes | Yes |
| Production checks | Ops monitor and the preflight | 14 of 14 live checks; preflight all PASS | Yes, for stock items | Yes |
| Go / no-go | Owner confirms Monday availability; one execute check-in chosen | Owner says go | Yes | Yes |

### Monday, November 16 (MT)

| When | Who | What | Pass |
|---|---|---|---|
| 6:00 AM | automatic | Weekly decision | Decision recorded for 2026-11-16 (TARGETS, or HOLD = no order day) |
| Before 7:30 AM | **owner** | Start at `/stocks/paper-auto`; ask chat "Are we ready for Monday?" | Pre-session items ✔ |
| 7:35/7:38 AM | check-in or owner | Release-branch execute, once | `posts > 0`; intents with `filledQty > 0` |
| After fills, before 2:00 PM | **owner** | Stop, then Start | Clean reconcile between them |
| After the close | automatic | Mark recorded; ops monitor | Gate reason advances past `STOCK_SUPERVISED_EXECUTE_REQUIRED` |
| All day | automatic | Props ticks, picks, settlement | Same checks as Saturday |

A shadow plan, a HOLD, a green workflow or an unfilled intent never counts as a fill.

## 13. Test evidence and links

| What | Result |
|---|---|
| All JS tests, `main` + this branch (local) | See the PR body for the final count |
| Props SQL migrations including `props_lab_v1` (local Postgres) | 7 of 7 suites PASS; integration 9 of 9 |
| Stock controller suite on #102 head `9e23e63` (local Postgres, fake broker) | 69 of 69; Python bridge tests OK; manifest writes on, real money off |
| Ledger audit on this branch (real ledger, read-only) | [43354773074](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43354773074): all accounts `IDENTITY_OK` |
| Preflight on `main` | [43339012343](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43339012343): every check PASS |
| First paid capture | [43308726133](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43308726133) |
| Nov 11 entries | [43211189347](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43211189347): #10–#15 VERIFIED |

## 14. Changes made, PRs and items awaiting owner approval

Made tonight (one PR, **not merged**):
- `scripts/props-ledger-verify*.mjs`: accounting identity per account (`ACCOUNTING … IDENTITY_OK/FAIL`), with
  known-payout and unknown-payout stakes reported separately. GET-only; tests added and wired into props CI.
- `src/lib/research/intake.ts` + tests: inactive research-intake foundation (§7). Wired into assistant CI.
- This report, and a status note in `docs/AI_LEARNING_LAB_2026_11_12.md`.

None of these changes touches prediction selection, risk settings, capture schedules, budgets, broker writes or any
live experiment.

Awaiting you:
1. Review and merge this PR (or not).
2. Optional: apply `database/props/props_lab_v1.sql`.
3. Choose one Monday execute check-in (§10.4).
4. Confirm the #102 auto-merge-on-gate behaviour (§10.5).
5. Monday: Start; then Stop and Start before the close.
6. Earlier open item: the read-only RLS query for the capture tables.
