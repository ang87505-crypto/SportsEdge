# SportsEdge pre-Monday completion report (2026-11-13, ~03:30 UTC)

Branch `claude/beautiful-knuth-6qw5zi` → [PR #157](https://github.com/ang87505-crypto/SportsEdge/pull/157). It is **not merged** and needs owner approval.

Every PASS below cites evidence. "Simulated" means a fake broker and an isolated database, never Alpaca. Tests passing
does not show that predictions are profitable.

## 1. Executive summary

- **PR #157 failure fixed at the root.** The failing browser check (`lab-390`, 528 px wide) was a **real UI bug on
  `/lab`**, which came in with #153. It is not caused by the test and was not flaky:
  - stock-layer verdicts with full-sentence reasons were rendered inside no-wrap badges;
  - it appeared only once the nightly research summary began publishing that section, so production `/lab` overflows
    on phones until #157 merges.

  Badges now show a short label, the reason is text that wraps, and there's a CSS safety net and a regression test.
  The local smoke passes 52 of 52; CI on an intermediate head (`d8fc90f`) is green.
- **Monday: on track for the supervised session, not yet verified, as it shouldn't be before Monday.** Every
  pre-session condition the release gate checks was passing on the 01:28 UTC Nov 13 watcher run, and 69 of 69 stock
  controller tests pass on #102's pinned head (simulated broker). The session itself (TARGETS decision, real fills,
  Stop/Start, close mark) can only be verified on Monday.
- **Learning Lab: ready to apply, waiting on you.**
  - On a scratch database, the migration and its tests pass; a second run fails cleanly and changes nothing (rows and
    triggers verified).
  - The preflight now reports `lab-schema`; production reads `NOT_APPLIED` today.
- **One real scheduling risk, quantified.** With the backup start delays seen on Nov 12 (10–38 minutes), anchors a few
  minutes after an even UTC hour are not guaranteed a backup capture. Nov 12 was covered with only 7 minutes to spare.
  Hourly backups would close the gap (a proposal; nothing changed).
- **New, all read-only or inactive:**
  - an experiment freeze manifest with a verifier;
  - accounting identity in the ledger audit;
  - research discovery and intake foundations (no schedule, no network);
  - a security fix that stops public chat from multiplying database reads.

## 2. Status table

| Area | Status | Evidence |
|---|---|---|
| PR #157 CI | **COMPLETE** (pending final head re-run) | Root-cause fix; CI green on `d8fc90f`; local smoke 52 of 52 |
| PR #102 (stock PAPER orders) | **BLOCKED** (Monday session) | Draft, unmerged, head `9e23e63` unchanged; gate `STOCK_SUPERVISED_EXECUTE_REQUIRED` |
| Learning Lab migration | **BLOCKED** (owner applies SQL) | Runbook §5; preflight `lab-schema: NOT_APPLIED` ([43357624566](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43357624566)) |
| Sports automation | **COMPLETE**, with a documented risk | Nov 12 paid capture; preflight all PASS; coverage analysis §7 |
| Stock automation (plans, checks, marks) | **COMPLETE** | Watcher run [43345210921](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43345210921) |
| Stock paper orders, real fills | **NOT STARTED** (Monday) | — |
| Experiment freeze tooling | **COMPLETE** | `scripts/experiment-manifest.mjs`, 4 tests; candidate baseline committed |
| Freeze applied | **NOT STARTED** (Sunday, owner) | §9 |
| Sports AI improvements | **PARTIAL** (research backlog; lab variants registered; nothing promoted) | §10 |
| Stock AI improvements | **PARTIAL** (roadmap; challengers forward) | §11 |
| Autonomous research engine | **PARTIAL** (discovery + intake foundation, inactive) | §12 |
| Conversational command center | **PARTIAL** (deterministic, tool-based; LLM not added) | §13 |
| Security review | **COMPLETE** for this pass; 1 issue fixed | §14 |
| Free-infrastructure plan | **COMPLETE** (plan); hard limits partly enforced | §15 |

## 3. Current production version

`198b27f` (PR #156) per the ops monitor (14 of 14 live checks, 2026-11-13 00:35 UTC). Nothing in this sprint was
deployed. Production still has the `/lab` phone overflow until #157 merges.

## 4. PR #157: what it now contains (none of it touches pick, stake, risk, budget, schedule or broker code)

| Commit | Change |
|---|---|
| `f1b0de5` | Ledger audit accounting identity; inactive research-intake card validator |
| `4238916` | Nov 12 readiness audit doc |
| `6626029` | **`/lab` phone overflow fix** (root cause above) and regression test |
| `4f48648` | Preflight `lab-schema` check (GET-only) |
| `d8fc90f` | Experiment freeze manifest and verifier; backup-coverage analysis |
| `574ab65` | Research discovery foundation (inactive) |
| `3307c6a` | Security: chat paths share the 60 s ledger cache |
| this doc | Pre-Monday completion report |

The 23 frozen experiment files are unchanged by this PR (`git diff origin/main` over the manifest file list is empty).

## 5. Learning Lab: verification and owner runbook

**Verified:**
- `props_lab_v1.sql` creates only six `props_lab_*` tables, two chronology triggers, a tampering view, RLS, and
  `service_role` SELECT/INSERT grants.
- It contains no statement that inserts, updates, deletes or alters any non-lab table. Its foreign keys point at the
  append-only `props_observations` and `props_entries`.
- Forecasts and flags are refused at or after lock, with data newer than lock, once a result exists, or under an
  unregistered spec hash. Timestamps are set by the database, and stakes are refused after lock or settlement. Every
  lab table is append-only.
- The worker writes only `props_lab_*`, makes no provider calls, and runs as a `continue-on-error` step after the paper tick.
- The migration and its tests pass on Postgres (`PROPS_LAB_V1_SQL_TESTS_PASS`). **A second run** fails at the first
  `CREATE TABLE` and rolls back. Row counts of every table and the trigger count (43) are identical before and after.
- Records carry `experiment_id`, `spec_sha256` and `variant_id`. Historical (retrospective) results live in
  `research/lab_*_20261112/` files; forward rows live only in the tables.

**Owner runbook (production DDL, needs your authorization):**
1. Supabase → project `vfyzbliksooljxrlfadp` → SQL editor. Paste `database/props/props_lab_v1.sql` exactly and run it
   once. Expect `COMMIT`. If it says `already exists`, it was applied before and nothing changed.
2. Verify (read-only): dispatch **Props activation preflight** on `main` after #157 merges (or on this branch). Expect
   `lab-schema: APPLIED` with tampered forecasts `0`.
3. After the next tick with games in a window, its lab step should report rows written instead of `NOT_MIGRATED`.
   Forward lab evidence begins then. **No historical lab forecasts will be created.**
4. Rollback: the lab tables are independent. Dropping them affects no paper table (all objects are named `props_lab_*`).

## 6. Monday stock release checklist

Evidence as of the 01:28 UTC Nov 13 watcher run (live ledger) and local simulated tests on `9e23e63`.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Correct Alpaca PAPER endpoint | **PASS** | Broker tests: one fixed paper host, no redirects, never a live host (`9e23e63`) |
| 2 | Real-money execution disabled | **PASS** | `realMoneyEnabled:false` on `main` and `9e23e63`; ledger parser refuses anything else |
| 3 | Correct account identity | **PASS** (as of Nov 13 01:28) | Gate passed ledger and account checks; an `ACCOUNT_MISMATCH` would block |
| 4 | Owner authorization enforced | **PASS** | Gate: ARMED by `owner`; live checks: owner APIs 401 without a session |
| 5 | Current account snapshot | **PASS** now; **NOT YET** for Monday | Clean check within 26 h at 01:28; Monday's own runs refresh it |
| 6 | No unexpected pending orders | **PASS** (as of 01:28) | `activeIntents` 0, `unresolvedIntents` 0 |
| 7 | No unknown fills | **PASS** (as of 01:28) | No non-strategy activity counted |
| 8 | Clean reconciliation | **PASS** (as of 01:28) | `lastCheckOk` true, no blockers |
| 9 | Valid weekly TARGETS decision | **NOT YET** | Monday 08:00 ET; a HOLD is a valid no-trade day |
| 10 | Decision within its window | **NOT YET** | Vercel 09:00 UTC kickoff + GitHub 11:20 UTC |
| 11 | Risk limits enforced | **PASS** (simulated) | $150 per order, $1,200 per day, 20 orders per day, 10 open, 3 attempts per leg, 25% drawdown stop, $1,250 capital; risk tests |
| 12 | Portfolio exposure checked | **PASS** (simulated) | Capital limit, planner tests |
| 13 | Duplicate submissions prevented | **PASS** (simulated) | Duplicate slot delivery does nothing; lease; unique reservations |
| 14 | Ambiguous broker responses | **PASS** (simulated) | A POST that timed out but filled is held uncertain and reconciled, never retried |
| 15 | Stop and Pause | **PASS** (simulated/API); live **NOT YET** | Owner Stop cancels working orders; owner API tests |
| 16 | Restart does not duplicate | **PASS** (simulated) | Resume tests; a later slot re-plans from broker state and holds |
| 17 | After-close marking | **PASS** (simulated); live **NOT YET** | Monitor tests; contamination and deposits handled |
| 18 | Independently auditable receipts | **PASS** | `scripts/paper-release-gates.mjs` re-reads the ledger and Actions receipts on the pinned head |
| — | Real Alpaca PAPER fills | **NOT YET** | Only Monday's session can show this |

**Scheduled Monday check-ins (both still enabled, verified 2026-11-13):**
- `trig_018nhvJDxGeNoky49ZBthdTV` (this session, 14:38 UTC): dispatches at most once, never retries an unknown outcome,
  and refuses if another release execute already ran that day.
- `trig_019yCBF3teLoxs5dK82vTLGi` (other session, 14:35 UTC): may redispatch on a skipped slot, and then runs the
  release watcher.

**Recommendation:** keep 14:38 and disable 14:35. Neither was changed without your authorization.

**Release watcher:** it runs with `apply:true`. Once the real-receipt gate passes, inside the window ending
2026-11-21, it merges #102 by itself, as previously designed. Confirm that you want this, or tell me to change the
plan so you merge by hand.

## 7. Sports automation reliability

| Scenario | Coverage |
|---|---|
| Missed GitHub runs | Vercel backups at 13, 15, 17, 19, 21, 23 and 01 UTC (`scheduler-kickoff.test.mjs`) |
| Missed Vercel backup | GitHub ticks run every 30 min when GitHub fires them; analysis below |
| Concurrent primary and backup | Integration "backup races … never repeat paid calls or entries"; one running run per kind |
| Provider timeout / partial data / rate limit | Outcome recorded as `provider_error`/`provider_http`, never retried automatically; normalizer rejects incomplete pairs; usage headers parsed strictly |
| Credit exhaustion | Budget tests; `budget_refused` claims; integration carryover test |
| Duplicate capture attempts | Unique claim per plan and purpose; preflight 0 duplicates on the real ledger |
| Event rescheduling | Quotes at or after the real start are rejected (normalizer + database lock trigger); a moved game can lose coverage, never integrity |
| No lines available | One retry after a wait, only with spare credits |
| Early/late fallback | Shared slate anchor (the Nov 9 failure test); Nov 12 fallback captured Mavericks @ Timberwolves |
| Pre-lock recording | Database chronology triggers |
| Missing / corrected box scores | Results stay pending; revisions append, latest wins |
| Postponed / DNP | Void legs; PrizePicks reboot rules in `settleEntry` |
| Payout accounting | `settleEntry` tests + the ledger `ACCOUNTING … IDENTITY_OK` on the real ledger |
| Credit reconciliation | v3 provider-actuals tests (not active) |
| Interrupted jobs | Abandoned-run recovery; unknown capture outcomes never repeated |

**Is a 2-hour backup interval enough?** (`src/lib/props/backup-coverage.ts`, tests read the real `vercel.json`)
- The late window is 145 minutes and backups are 120 minutes apart. With a constant start delay, every anchor tip is
  covered.
- With the delays observed on Nov 12 (backups started at 13:20, 15:20, 17:10, 19:17, 21:17 and 23:38, i.e. 10–38
  minutes late), anchors at **:11–:12 past each even UTC hour** are not guaranteed.
- With 5–45 minute delays, that grows to **14-minute holes**, including common 7:10 PM ET tips.
- Nov 12's 00:10 UTC anchor was covered only because the 21:00 backup started at 21:17, 7 minutes inside the window.
  The 23:00 backup started after the window closed.

**Proposed fix (needs approval):** add backup ticks at 14, 16, 18, 20, 22 and 00 UTC (21 → 27 Vercel crons; confirm
the plan's cron allowance first). This adds no credits: ticks with nothing due spend nothing. Under the analysis it
closes every gap.

## 8. Experiment freeze and data integrity

| Requirement | How it is met | Status |
|---|---|---|
| Frozen before forward evaluation | Manifest pins 23 decision files + constants; `verify` exits 1 on drift | Tooling COMPLETE; freeze NOT STARTED |
| Predictions immutable after lock | `props_*` chronology + append-only triggers | Verified (SQL tests) |
| No silent historical revision | Results are revisions, never updates; lab rows hash-checked by a tampering view | Verified |
| Late data tracked separately | `ingested_at` vs `provider_last_update`; later result revisions | Verified |
| Failures stay in the record | Runs keep failed/abandoned outcomes; capture claims keep unknown outcomes | Verified |
| Skipped opportunities counted | Decisions with `skipped` status; receipts count `skippedDecisions` | Verified (run 29: 66 skipped) |
| Challengers cannot overwrite active | Predictions unique per (observation, model version); lab in its own tables | Verified |
| New versions = new cohorts | Model and selection versions on every row; v2 accounts for learning models | Verified |
| Rules fixed before results | Pre-registration docs; manifest diff; spec SHA-256 for lab | Verified (tooling) |
| Outcomes traceable | ESPN box score rows with event and athlete ids; ledger audit re-grades | Verified |

## 9. Sunday freeze procedure (recommended 18:00 UTC, subject to your confirmation)

1. Merge only what you've approved. **Not #102.**
2. On `main`: `node --experimental-strip-types scripts/experiment-manifest.mjs verify docs/experiments/manifest-2026-11-13-candidate.json`.
   Expect `FROZEN_MATCH`. Merging #157 does not change any frozen file.
3. Snapshot: `… snapshot docs/experiments/manifest-2026-11-15-freeze.json` and commit it (records the git commit).
4. No merges until Monday's after-close mark. The ops monitor shows the production commit.
5. Expected, intentional drift: if the gate passes and #102 merges, `brokerWritesEnabled` flips. That starts a new
   cohort ("paper orders on"); snapshot again.

## 10. Sports AI research backlog (ranked; all research-only; promotion only through the existing gate)

Evidence so far:
- 81 graded recorded picks, 58.0% hit rate, Brier 0.250.
- Less picks 40 of 61; More picks 7 of 20.
- Picks where the model disagreed with the line by 15–25% hit 10 of 25.
- Players with 5 or fewer games of history hit 3 of 8.
- Retrospective lab: recalibration helps most (−0.00254 Brier on 2025-26 H2); no layer is distinguishable from zero
  yet in 2026-27.

| Rank | Idea | Why | Data | Experiment |
|---|---|---|---|---|
| 1 | Probability calibration (temperature, gap shrink, lab recalibration) | Overconfidence is the clearest measured problem | Existing | Already registered; gate 500 lines / 14 dates / 50 games |
| 2 | Expected-minutes uncertainty and role change | Minutes surges/collapses are 3.4× and 1.6× over-represented in misses | Existing box scores | Lab role/minutes layer forward |
| 3 | Injury / availability | Biggest missing input | NBA official injury report (free PDFs; terms review needed) | Feasibility study first |
| 4 | Side asymmetry (More vs Less) | 35% vs 66% on small samples | Existing | Pre-register one rule; Holm across variants |
| 5 | Sportsbook consensus blend | Books often price minutes risk | Stored book quotes | Lab market layer (needs same-line quotes) |
| 6 | Hierarchical shrinkage for low-history players | 3 of 8 with ≤5 games | Existing | New variant spec |
| 7 | Dispersion calibration per stat (distributional) | NB already distributional; check tails | Existing | Calibration-by-quantile report |
| 8 | Correlation and portfolio exposure | Entries share slates | Existing | Report only |
| 9 | Gradient-boosted / ensembles | Small forward data; overfit risk | Existing | Only after 1–3 |
| 10 | EV display and variable staking | Flat $5 until calibrated | Existing | Shadow staking (needs lab SQL) |

Metrics for every experiment: Brier, log loss, calibration error, hit rate, coverage, expected vs realized, return
under PrizePicks terms, by stat and confidence band. Chronological splits only.

## 11. Stock AI research roadmap (ranked; nothing changes the Monday strategy)

| Rank | Research | Data (free) | Bias controls | Status |
|---|---|---|---|---|
| 1 | Clean forward record of the weekly strategy | Alpaca PAPER | Verified marks, contamination chain | Starts Monday |
| 2 | Behaviour ablation forward (regime, attention, volatility, overreaction) | Alpaca bars | Frozen before the open; 26 weeks | First freeze expected for the week of Nov 16 |
| 3 | Volatility targeting / regime overlay | Alpaca bars | Exposure-matched SPY, costs 10/25 bps | Spec only |
| 4 | 13F and fund-disclosure followers | SEC EDGAR, fund pages | Filing dates, 45-day lag, delisting | Forward running |
| 5 | Insider filings (Form 4) | SEC EDGAR (2-day disclosure) | Point-in-time parsing; quarterly dataset lags | Spec only |
| 6 | Quality/value fundamentals | SEC XBRL company facts (free, filing-dated) | Filing-date point-in-time; restatements | Spec only |
| 7 | Post-earnings drift | 8-K filing times (EDGAR) | Announcement timestamps | Spec only |
| 8 | Intraday | Needs consolidated quotes (paid) | — | BLOCKED |

Every challenger reports CAGR, Sharpe, Sortino, max drawdown, volatility, turnover, win/loss, exposure and net return
after costs, against SPY, exposure-matched SPY and the live weekly strategy, with a walk-forward split and an untouched
holdout. Historical results never count as evidence of future returns.

## 12. Autonomous research engine

| Stage | Status |
|---|---|
| 8A Discovery: OpenAlex, arXiv request plans and parsers; terms checked against the providers' own documentation on 2026-11-13 (OpenAlex free, 10 req/s without a key; arXiv one request per 3 s, metadata CC0; SEC EDGAR 10 req/s with User-Agent) | **Foundation done** (`src/lib/research/discovery.ts`), inactive |
| 8B Source verification (URL, dates, author, type, conflicts, verifiability, credibility score) | **Done** (`intake.ts` `SourceRef`, `credibility()`) |
| 8C Strategy extraction into a testable card | **Done** (card schema + validation; extraction is deterministic or manual; an LLM extractor is optional, off) |
| 8D Research memory (seen papers, statuses, rejection reasons; new formulations allowed) | **Done** (append-only records; `newLeads`, `currentStatus`) |
| 8E Pre-registration and isolated testing | **Existing process** (committed pre-registration + existing engines) |
| 8F Scheduling with caching, dedupe, budgets, backoff and failure logs | **Partial**: request plans, per-run caps, backoff and dedupe are done; the job and its storage on `research-data` are not built and need approval |

External text is always data: control and bidi characters are stripped, length is capped, instruction-like text is
flagged and never acted on. A test proves these modules cannot reach a model, rule, stake, budget, schedule, database
or network.

**Remaining integration work:**
- a manual-dispatch workflow that runs plans on fixtures first, then live;
- JSONL storage on `research-data`;
- a review queue page.

## 13. Conversational command center

**Today:** deterministic understanding with follow-up context, over typed read-only tools:
- props ledger, ops monitor, research summary, lab views;
- owner-gated stock ledger and broker snapshot;
- proposals (Pause/Stop) that only your Confirm executes, through the existing owner endpoints.

Answers carry their data times (operations check time, research report time). No paid AI.

**LLM options compared (none added):**

| Option | Cost | Hardware | Fit |
|---|---|---|---|
| Keep deterministic (current) | $0 | None | Reliable; limited phrasing |
| Local open model (e.g. 7–8B instruct, quantized, via llama.cpp) | $0 software | Always-on machine with 8–16 GB RAM | Conflicts with "no personal computer"; not possible on Vercel serverless |
| Batch summaries on GitHub Actions CPU | $0 within free minutes | Runner CPU (slow, a few tokens/s) | Fine for weekly research digests, not live chat |
| Hosted free tiers (new provider account) | $0 at low volume, limits change | None | Needs your approval; must stay optional with a deterministic fallback |

**Recommendation:**
- keep the deterministic core;
- add optional batch summarization for research digests later, with a hard cap and no tool access.

## 14. Security findings (ranked)

| Severity | Finding | Status |
|---|---|---|
| Medium | Public chat briefing, lab and control-proposal paths bypassed the 60 s ledger cache, so anyone could multiply database reads | **Fixed** in #157 (`3307c6a`) with a regression test |
| Medium | Capture-table RLS still not confirmed in production | Open: run the read-only RLS query (owner) |
| Low–Medium | No per-IP rate limit on the public chat endpoint | Mitigated by caches, 2,000-byte body cap and 300-character messages; propose a per-instance token bucket after Monday |
| Low | Two Monday execute check-ins from two sessions | Guarded; recommend disabling one |
| Low | Release watcher auto-merges #102 once the gate passes | By design; owner to confirm |
| Info | Paper/live separation | Fixed paper host; live host unreachable from the adapter (tests) |
| Info | Secrets | Not printed by any script reviewed; manifest strips key/secret/token/account fields; GitHub masks secrets |
| Info | Prompt injection | Chat is deterministic with no tool path; research text untrusted and flagged |
| Info | Owner endpoints, cron endpoints | 401 without a session or `CRON_SECRET` (live checks) |

## 15. Free infrastructure and hard limits

| Resource | Limit in force | Status |
|---|---|---|
| The Odds API | 7 per 24 h, 200 per 30 d, floor 60 (database + source, stricter wins) | Enforced, verified |
| Research discovery | ≤20 OpenAlex / ≤10 arXiv requests per run, spacing per terms | Coded, inactive |
| GitHub Actions | Free tier; jobs have timeouts | Schedules unreliable |
| Vercel | 21 daily crons | At the current count; adding 6 needs the plan allowance confirmed |
| Supabase | Free tier; chat reads now cached | Storage limits not re-measured tonight |
| LLM | $0 (none used) | — |

**Cannot realistically run at $0:**
- consolidated intraday quotes;
- licensed news sentiment;
- point-in-time earnings estimates;
- Pick6 payout data (not published).

## 16. Test results (this branch, local unless noted)

| Suite | Result |
|---|---|
| All JS/TS tests | 722 tests: **682 passed, 0 failed, 40 skipped** |
| Python research (`analytics/research`) | 100 OK |
| Python analytics (`analytics/test_*.py`) | 423 OK |
| Props SQL migrations (7 suites, including the lab) + integration | 7 of 7 PASS; 9 of 9 |
| Lab migration rerun | Fails atomically; 0 row/trigger changes |
| Stock controller suite on `9e23e63` (real Postgres, simulated broker) | 69 of 69 |
| TypeScript | exit 0 |
| ESLint | 0 errors (3 pre-existing warnings) |
| Production build | OK |
| Browser smoke (desktop + mobile) | 52 of 52 |
| Assistant HTTP smoke / owner sign-in smoke | PASS / PASS |
| GitHub CI on `d8fc90f` | 8 of 8 green (final head re-run pending at writing) |
| Preflight on this branch (real ledger, read-only) | All PASS; `lab-schema: NOT_APPLIED`; `ACCOUNTING … IDENTITY_OK` |

The 40 skipped JS tests need a live Postgres or broker flag (`PAPER_AUTO_E2E_PG`, `PROPS_PG_TEST`). The ones that
matter for Monday were run separately above.

## 17. Friday–Monday plan and go/no-go

**Friday Nov 13**
- Confirm #157 is green on its final head and review it.
- Nov 12 entries #16–#18 settle (09:20/10:00 UTC); run the ledger audit: expect VERIFIED + `IDENTITY_OK`.
- Optional: apply the lab SQL before ~23:00 UTC.
- Calibration review on the PrizePicks breakdown (no model change).

**Saturday Nov 14**
- 48-hour capture review (06:10 UTC check-in).
- Scheduler check: compare backup start delays with §7.
- Stock lab freeze appended on `research-data`.
- Rerun the stock controller suite if anything changed.

**Sunday Nov 15**
- Weekly learning: no promotion (auto-switch off).
- Freeze at 18:00 per §9.
- Production `/api/version` = `main`; #102 head = `9e23e63`; ops monitor 14 of 14; preflight PASS.
- Disable one Monday check-in.
- **Go/no-go.**

**Monday Nov 16 (MT)**
- 6:00 AM: decision.
- Before 7:30: confirm armed (Start is refused while already armed; it's needed only if stopped).
- 7:35/7:38: one release execute; inspect real fills on the Autopilot "Risk and execution" panel.
- After fills, before 2:00 PM: Stop, then Start.
- After the close: mark recorded.
- Ops monitor after 22:00 UTC: gate reason.
- No model changes all day.

**GO if all hold:**
- ops monitor 14 of 14;
- gate shows `STOCK_SUPERVISED_EXECUTE_REQUIRED` (ARM and clean account);
- #102 head unchanged;
- manifest `FROZEN_MATCH`;
- you're available 7:30 AM–2:00 PM MT.

**NO-GO if any holds:**
- a gate reason before `…EXECUTE_REQUIRED`, such as `STOCK_ACCOUNT_NOT_CLEAN` or `STOCK_OWNER_START_REQUIRED`;
- an unresolved intent;
- manifest drift;
- a market holiday.

**HOLD decision:** a valid no-trade day. Nothing is forced, and the next weekly decision is Nov 23, outside the
watcher window, so you'd merge by hand later.

## 18. Owner actions required

1. Review and approve or merge PR #157.
2. Optional: apply `props_lab_v1.sql` (§5).
3. Run the read-only RLS query for the capture tables.
4. Choose one Monday check-in (recommend keeping 14:38 UTC).
5. Confirm or change the release watcher's auto-merge of #102.
6. Approve or decline the extra hourly backup crons (§7).
7. Confirm the Sunday 18:00 UTC freeze.
8. Monday: be present; Stop then Start before the close.

## 19. Next development priorities

1. Hourly tick backups (closes a measured capture gap) after Monday.
2. Lab forward evidence (needs the SQL).
3. Injury-report feasibility (largest missing sports input).
4. Research discovery job on fixtures, then live, writing only to `research-data`.
5. Per-IP chat rate limit; GitHub Actions version upgrade.

## 20. Exact files changed in PR #157

`.github/workflows/assistant-verify.yml`, `.github/workflows/props-verify.yml`,
`docs/AI_LEARNING_LAB_2026_11_12.md`, `docs/SPORTSEDGE_NOV12_AI_READINESS.md`,
`docs/SPORTSEDGE_PRE_MONDAY_COMPLETION.md`, `docs/experiments/manifest-2026-11-13-candidate.json`,
`scripts/experiment-manifest.mjs`, `scripts/experiment-manifest-lib.mjs`, `scripts/experiment-manifest.test.mjs`,
`scripts/props-activation-preflight.mjs`, `scripts/props-activation-preflight-lib.mjs`,
`scripts/props-activation-preflight.test.mjs`, `scripts/props-ledger-verify.mjs`, `scripts/props-ledger-verify-lib.mjs`,
`scripts/props-ledger-verify.test.mjs`, `src/app/lab/page.tsx`, `src/app/pages.css`, `src/lib/assistant/lab-answer.ts`,
`src/lib/lab/stocks-summary.ts`, `src/lib/lab/stocks-summary.test.mjs`, `src/lib/lab/view.ts`,
`src/lib/props/backup-coverage.ts`, `src/lib/props/backup-coverage.test.mjs`, `src/lib/research/discovery.ts`,
`src/lib/research/discovery.test.mjs`, `src/lib/research/intake.ts`, `src/lib/research/intake.test.mjs`,
`src/lib/server/assistant-handler.ts`, `src/lib/server/site-assistant-handler.ts`,
`src/lib/server/site-assistant-handler.test.mjs`.

Deployment evidence: none. Nothing was deployed or merged in this sprint.
