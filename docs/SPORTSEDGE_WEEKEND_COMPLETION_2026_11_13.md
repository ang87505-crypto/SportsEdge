# SportsEdge weekend completion (Saturday + Sunday engineering, done Fri Nov 13, 2026, ~13:45 UTC)

**What this report covers:**
- All Saturday and Sunday engineering that can be done before those days.
- Nothing here claims a Sunday or Monday event has happened. The freeze is not taken (§10), and no real Alpaca
  PAPER fill exists yet (§5).

**Simulation vs reality:**
- Simulated means a fake broker and an isolated local PostgreSQL database.
- Every stock result below is simulated unless stated otherwise.
- No real money, real wager or Alpaca order was used or sent.

**Feature status labels:** five separate claims, never interchangeable.
1. Implemented
2. Tested
3. Deployed
4. Activated
5. Verified with genuine external evidence

## 1. What finished tonight

| Task | Result |
|---|---|
| PR integration | `main` + #157 + #158 + #159 + #160 + the CLOCK_SKEW and UX branches merge cleanly and pass everything together (§2). Two real integration defects were found and fixed (below). |
| #157 / #158 merge break | #157's coverage test pinned the live backup set to odd hours, so merging #158 after it would have turned `main` red. Fixed in #157: the Nov 12 analysis uses a pinned historical set, and a new test only lets the schedule *add* backups. |
| #157 / #160 workflow conflict | Both edited the same CI line. #160's test now runs as its own step. |
| #158 delay matrix | Delay matrix tests added, plus the measured residual risk (§9). |
| Sports reliability ([#160](https://github.com/ang87505-crypto/SportsEdge/pull/160)) | **Defect fixed:** a tick whose capture failed at the provider finished `NO_LINES_CAPTURED` with a **green** job. It is now red (`CAPTURE_PROVIDER_FAILED`); credit limits and no-lines days stay green but are named distinctly. The provider client got its first direct tests (11 new tests). |
| Stock CLOCK_SKEW | Direct tests added: broker clock ±61 s blocks, 59 s passes, quotes 3 s in the future block, recovery has no duplicates. A mutation check proves they bite. They run on the **exact pinned #102 code** without changing #102 (§5). |
| Monday rehearsal | One continuous simulated session dated 2026-11-16 (§5). |
| Website QA | 21 routes × 7 widths (320/375/390/528/768/1024/1440) = 147 combinations, plus 27 internal links. **Defect fixed:** standalone links and a checkbox were 16–21 px tall on phones (below the WCAG 2.5.8 24 px minimum). Browser smoke now enforces 24 px. |
| Assistant honesty | The assistant now states that answers come from built-in topics over SportsEdge's own records and that no external AI model is called (true; none exists in the code). |
| Freeze gap | **Defect fixed:** the $5 stake, daily entry caps, bankroll, credit enforcement and the stock order/daily/drawdown limits are defined in SQL migrations that were *not* frozen. They are now; the drill proves a changed stake row is caught (§10). |
| Freeze reporting | `verify` now lists recorded-file changes (`FROZEN_MATCH_WITH_RECORDED_CHANGES`), so a schedule change is documented as a data-collection change, never silent. |
| Sunday check | New manual, read-only workflow *Experiment freeze check*: manifest verify, production = `main`, #102 still pinned. |
| Security | Secret scan clean; every internal route refuses unauthenticated calls with no leaks; owner session design verified (§8). |

## 2. What passed

Integration commit `6013e661054b837c57717f1ce5301ba5aee7cc44` (`main` `198b27f` plus all six weekend branches), local:

| Suite | Total | Passed | Failed | Skipped | Note |
|---|---|---|---|---|---|
| TypeScript (`tsc`) | — | exit 0 | 0 | — | |
| ESLint | — | 0 errors | 0 | — | 3 pre-existing warnings |
| Production build | — | OK | 0 | — | |
| All JS/TS tests | 751 | 708 | 0 | 43 | Skips: 34 stock e2e (need `PAPER_AUTO_E2E_PG=1`) and 9 props integration (need `PROPS_PG_TEST=1`). **Both groups were run separately; see the next two rows.** |
| Stock controller/broker/risk/worker/owner e2e (real Postgres, simulated broker) | 86 | 86 | 0 | 0 | Includes the CLOCK_SKEW tests and the Monday rehearsal |
| Same suites on the **pinned #102 head `9e23e63`** (isolated worktree) | 87 | 87 | 0 | 0 | Extra test from #102's own files |
| Props Postgres integration (`PROPS_PG_TEST=1`) | 9 | 9 | 0 | 0 | |
| Props SQL migration suites | 7 | 7 | 0 | 0 | v1, budget v2, market, learning, capture, budget v3, lab |
| Stock SQL contract (`paper_auto_v1` + `risk_v2`) | 1 suite | PASS | 0 | — | Run directly on local PostgreSQL 16. The repo script needs Docker/PostgreSQL 17, unavailable here; CI runs that one |
| Python research | 100 | 100 | 0 | 0 | |
| Python analytics | 423 | 423 | 0 | 0 | |
| Browser smoke (desktop + mobile, incl. the new 24 px rule) | 52 | 52 | 0 | — | |
| QA crawl (21 routes × 7 widths) | 147 | 147 with no overflow, broken link or placeholder text | 0 | — | 3 remaining small targets are exempt inline sentence links and an 18 px checkbox inside a 24 px label |
| Assistant HTTP smoke; owner sign-in smoke | — | PASS; PASS | — | — | |
| Experiment manifest verify | — | `FROZEN_MATCH_WITH_RECORDED_CHANGES` | — | — | 0 drift; recorded changes are #158's `vercel.json` and `scheduler-kickoff.ts` |
| Freeze tamper drill | 8 cases | 8 correct | 0 | — | §10 |
| Unauthenticated probe of all 22 API routes | 22 | 22 refuse or serve only public data | 0 | — | §8 |

**GitHub CI:**
- **#157:** last observed green on `268c638` (all 6 workflows).
- **#158, #159:** last observed green except the inherited `/lab` smoke failure (fixed by #157).
- **Not observed:** the weekend commits pushed after ~04:15 UTC (#157 `043bdc5`→`5dcf2a3`, #158 `5a269f2`, #160 `326e05b`). The GitHub tools in this session disconnected (HTTP 503) before those runs finished. **Check them on the PR pages before merging.**

## 3. Production readiness

- **Production and `main`:** `main` = `198b27f`. Production served `main` per the 02:43 UTC ops monitor (14 of 14 live checks).
- **Not re-checked from here:** this sandbox's network now refuses the production host (proxy CONNECT 403). Re-check through GitHub with *Operations monitor* or the new *Experiment freeze check*.
- **Nothing was merged, deployed, scheduled or migrated.**
- **Merge-ready:** all weekend PRs are ready for you to merge (§11). Monday does not depend on any of them, and the release path (#102) is unchanged.

## 4. Sports readiness

- **Lifecycle audit.** Every stage, from collection → line validation → prediction → pre-lock freeze → candidate storage → virtual entry → settlement → reporting, has database-level and unit tests:
  - capture failures: missed GitHub/Vercel runs, a dead provider, no lines, credits exhausted, duplicate triggers and concurrency;
  - integrity: pre-lock enforcement in the database, model versions, duplicate refusal, revisions as append-only, cross-platform lines counted once;
  - settlement: DNP/void, postponed, missing and corrected box scores, Pick6 unknown, PrizePicks table, accounting identity.
- **Gaps found and fixed (#160):**
  - **Silent green tick:** now red (`CAPTURE_PROVIDER_FAILED`).
  - **Untested provider client:** now tested for timeout, non-JSON, oversized, error status, empty, strict usage headers and malformed input. A timeout after reservation keeps the credits counted, never retries, and stores nothing.
- **Monitoring states:**
  - The dashboard already separates: waiting, budget refused, no lines, nothing qualified, capture failed, windows missed, no games, owner pause.
  - The ops monitor separates: missed, ran late, stuck, released off, and "green but collected nothing for two days".
  - #160 closes the last gap, where a failed capture still showed a green job.
- **Rescheduled games:** handled safely but can miss. A game moved after planning keeps its original capture windows. Any quote at or after the real start is refused, so nothing is fabricated; the capture shows as missed.
- **Reliability:** operating on real ledger receipts since Nov 12 (Friday report). Picks 37 of 61 (60.7%) vs 64.9% stated, z 0.69. No active model change is justified, and none was made.

## 5. Stocks readiness

- **Pinned code:** the controller, risk and broker files on `main` are **byte-identical** to the pinned #102 head (blobs `c14ea4c6e4`, `b72dd96afa`, `3e1154cb07`). Only the release-flag file differs.
- **CLOCK_SKEW coverage:** both enforcement points now have direct tests, and they pass against the pinned head in an isolated worktree. **Honest scope:** the tests live on branch `-clock-skew`, not inside #102. Merging them changes no #102 file, so the release stays qualified.
- **Simulated Monday rehearsal** (one test, real schema, fake broker, dated 2026-11-16), every step passing:
  1. Execute before Start → `GATE_STOPPED`, no order.
  2. Start (clean reconcile + owner) at 14:20Z; a slot before the 14:30Z open → `OUTSIDE_EXECUTION_WINDOW`.
  3. 14:45Z: AAA fills 1 of 3, BBB fills, CCC rests → `ORDERS_WORKING`.
  4. Duplicate delivery of the slot → `SLOT_ALREADY_FINISHED`, nothing sent.
  5. Owner Stop → next slot cancels both working orders, `GATE_STOPPED`.
  6. Start again only after a clean reconcile → residual re-planned (AAA 2, CCC 5) → `ORDERS_COMPLETE`. Positions exactly match the targets: **no duplicate fills**.
  7. Later slot `PLAN_HOLD`; slot after the 20:40Z cutoff → `OUTSIDE_EXECUTION_WINDOW`.
  8. Monitor before the close → `BEFORE_CLOSE`; after the close → `DAILY_RECORDED`.
  9. The dashboard read model shows the mark cash-reconciled, uncontaminated, state `READY` (armed). The page labels this **Planning only** while broker writes are off on `main`, and **Running** once released.
- **The 25 Friday scenarios** remain covered (Friday report §7), plus CLOCK_SKEW.
- **Go/no-go refusal tests:** wrong account, external orders, unknown prior execution, no valid decision, HOLD/MISSED, risk/drawdown, duplicate dispatch, timing and broker failure are controller e2e tests. Release head changed and checks not green are release-gate tests (13). Freeze drift is the manifest drill.
- **Live-money path:** none.
  - The broker adapter accepts only the Alpaca PAPER host and refuses redirects.
  - Routes return `non_paper_broker_denied` for anything else.
  - `realMoneyEnabled:false` on `main` and `9e23e63`.
- **Not yet proven:** a real Alpaca PAPER fill, real Stop/Start on the live page, and a real after-close mark. These happen only on Monday.

## 6. Learning Lab

- **Actual status:** `props_lab_v1.sql` is **not applied** in production (preflight 43357624566: `lab-schema: NOT_APPLIED`).
- **Readiness (verified Friday, unchanged):**
  - the migration and tests pass; a rerun fails atomically with no change;
  - only `props_lab_*` objects are created, with RLS on and `service_role` SELECT/INSERT only;
  - forecasts and shadow stakes are frozen before lock; the tables are append-only, with a tampering view;
  - the worker reports `NOT_MIGRATED` and exits 0 when absent, and its CI step is `continue-on-error`.
- **Weekend change:** the lab migration is now a *recorded* manifest file, so applying or changing it is reported but never breaks the active experiment.
- **Activation (one owner step):**
  1. Supabase → project `vfyzbliksooljxrlfadp` → SQL editor.
  2. Run `database/props/props_lab_v1.sql` once.
  3. Dispatch *Props activation preflight*; expect `lab-schema: APPLIED`, tampered 0.
- **Sports and stocks are unaffected either way.**

## 7. AI systems

| System | Implemented | Tested | Deployed | Activated | Verified with real external evidence |
|---|---|---|---|---|---|
| Sports AI (stats model, selection, entries, settlement) | Yes | Yes | Yes | Yes | Yes: real ledger since Nov 7; 61 graded picks |
| Sports challengers (learning layer, shadow scoring, calibration study) | Yes | Yes | Yes | Shadow only | Partly: forward scoring, too little data for promotion |
| Learning Lab (forecast freezing, shadow stakes) | Yes | Yes | Code yes | **No** (SQL not applied) | No |
| Stock AI (weekly momentum, controller) | Yes | Yes (simulated) | Main yes; order path on #102 | Decisions yes; **orders no** | Decisions yes; **fills no** (Monday) |
| Stock research challengers | Yes | Yes | Yes | Research only | Backtests only; all fail their gates |
| Chat command center | Yes (deterministic topics over real records; no LLM) | Yes | Yes | Yes | Yes for answers from real ledgers; owner actions are proposals the owner confirms |
| Autonomous internet research | Foundations only (`intake.ts`, `discovery.ts`) | Yes (isolation tests) | No (#157) | No | No |
| Conversational language model | **No** | — | — | — | — |

Consistency: Sports and Stocks pages and the assistant read the same loaders (`cachedPropsRaw()` after #157, the paper-auto ledger read model), so they cannot disagree on recorded numbers.

## 8. Security

**Confirmed:**
- **Secret scan:** tracked files are clean.
- **Owner session:**
  - HMAC-signed, 30-minute expiry enforced server-side and capped at issue;
  - constant-time check;
  - cookie `HttpOnly; Secure; SameSite=Strict`.
- **Unauthenticated probe of all 22 API routes:**
  - every internal route returns 401, 403, 404 or 405, or 503 when owner access is unconfigured (fail-closed);
  - no stack trace, host, key or `service_role` text in any body;
  - public routes return only public data.
- **Cron auth:** `CRON_SECRET` checks (scheduler tests).
- **data-health:** constant-time check (#159).
- **Public chat:** read amplification fixed (#157).
- **Research content:** untrusted research text cannot trigger actions (tests).

**Remaining:**
- **Production RLS:** BLOCKED — OWNER ACTION. Run the read-only query in the Friday report §8; there is no SQL access from here, and PostgREST cannot read `pg_policies`.
- **No per-IP rate limit on public chat:** low–medium. Mitigated by the cache and size limits; proposal for after Monday.
- **Production headers and deployment protection:** not re-checked tonight, because production is unreachable from this sandbox.

## 9. Scheduler

**Delay assumptions:**
- **Documented:** Vercel Hobby fires a daily cron anywhere in its hour (0–59 min); 100 crons per project.
- **Observed:** backup starts 10–38 min after the hour (Nov 12). GitHub dropped 26 of 33 slots over 7 days.
- **Hypothetical:** 0–90 min.

**Guaranteed late-window coverage** (anchor tips 17:00–04:00 UTC, 661 tip-minutes, GitHub assumed dropped):

| Delay model | Odd hours (current) | Hourly (#158) |
|---|---|---|
| Fixed 0 / 30 / 60 / 75 / 90 min | 0% uncovered | 0% |
| Observed 10–38 min | 1.5% | 0% |
| 0–30 min | 3.0% | 0% |
| 0–60 min (documented) | **25.7%** | **0%** |
| 0–75 min (documented + queue) | **37.1%** | **0%** |
| 0–90 min (hypothetical) | 49.2% | **6.7%** (4-minute holes at :01–:04) |

**Residual risk after #158:**
- **No redundancy:** with GitHub dropped, 374 of 661 tip-minutes (documented timing) depend on a *single* Vercel backup firing; at observed delays, 22.
- **Both schedulers down:** if both fail, nothing captures. The dashboard shows `MISSED`, never "captured".

**What does not change:**
- budget, claims, one-running-run and unknown-outcome-no-retry are unchanged;
- extra ticks with nothing due cost 0 credits;
- 28 of 100 crons.

**Approval needed:** #158 changes production scheduling only after you merge and Vercel deploys it.

## 10. Experiment freeze

- **Prepared state** (candidate `docs/experiments/manifest-2026-11-13-candidate.json`):
  - `props-paper-v1`: 21 frozen files (15 code, 6 SQL);
  - `stock-v2-weekly-1`: 10 frozen files (8 code, 2 SQL);
  - 11 recorded files.
- **Actual state:** **not frozen**. The official freeze is Sunday 18:00 UTC; no future-dated record was created.

**Tamper drill** (isolated worktree, each change reverted):

| Change | Result |
|---|---|
| None | `FROZEN_MATCH`, exit 0 |
| Model file `model_v1.json` | `DRIFT`, exit 1 |
| Stake row in `props_v1.sql` | `DRIFT`, exit 1 (missed before tonight's fix) |
| Selection threshold 0.60→0.58 | `DRIFT`, exit 1 |
| Stock risk: max order $150→$200 | `DRIFT` (file + registration), exit 1 |
| Protected schedule assumption: LATE window 180→200 min | `DRIFT` (file + capturePlan), exit 1 |
| Backup cron hour in `vercel.json` | `FROZEN_MATCH_WITH_RECORDED_CHANGES`, exit 0, change listed |
| Research registry + a doc | `FROZEN_MATCH_WITH_RECORDED_CHANGES` / no effect, exit 0 |

**Sunday actions:** §13 step 1.

## 11. PRs

| PR | Head | Checks | Mergeable | Owner requirement |
|---|---|---|---|---|
| [#157](https://github.com/ang87505-crypto/SportsEdge/pull/157) readiness, audits, freeze tooling | `5dcf2a3` | Green on `268c638`; newer commits not observed (tools down) | Clean with all others (local) | Merge first |
| [#158](https://github.com/ang87505-crypto/SportsEdge/pull/158) hourly backups (draft) | `5a269f2` | Green except inherited `/lab` smoke | Clean | Decide before Sunday 18:00 UTC or after Monday; update from `main` after #157 |
| [#159](https://github.com/ang87505-crypto/SportsEdge/pull/159) data-health constant-time | `c0e509a` | Green except inherited `/lab` smoke | Clean | Update from `main` after #157, then merge |
| [#160](https://github.com/ang87505-crypto/SportsEdge/pull/160) provider-failure tick red; provider tests | `326e05b` | Not observed | Clean | Merge |
| `claude/beautiful-knuth-6qw5zi-clock-skew` (**PR not opened**: GitHub tools disconnected) | `9283c43` | — | Clean | Open a PR, or ask me to once tools return |
| `claude/beautiful-knuth-6qw5zi-ux-touch` (**PR not opened**: GitHub tools disconnected) | `72497c8` | — | Clean | Same. Its smoke passes once #157 is merged |
| [#102](https://github.com/ang87505-crypto/SportsEdge/pull/102) stock PAPER orders | `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811` (unchanged) | Draft, mergeable clean | — | **Do not merge by hand.** The release watcher auto-merges (see below) |

**#102 release watcher:**
- **Configuration:** `paper-release.yml` runs hourly at :43 in `release` mode with `apply:true`, until `2026-11-21T07:00Z`.
- **Behaviour:** once real receipts show a manual real fill, a clean same-session close, and an owner Stop followed by Start, it squash-merges #102 at exactly `9e23e63`.
- **Last run** (01:28 UTC): `STOCK_SUPERVISED_EXECUTE_REQUIRED`, not ready.
- **Owner decision:** keep that auto-merge, or disable it and merge by hand. Unchanged.

## 12. Unresolved blockers

| Item | Status |
|---|---|
| Real Alpaca PAPER fills, real Stop/Start, real close mark | BLOCKED — EXTERNAL DEPENDENCY (Monday's session) |
| Sunday freeze snapshot | BLOCKED — scheduled time (Sunday 18:00 UTC) + owner confirmation |
| Lab SQL | BLOCKED — OWNER ACTION (optional) |
| Production RLS query | BLOCKED — OWNER ACTION |
| #158 schedule change | BLOCKED — OWNER ACTION |
| PRs for `-clock-skew` and `-ux-touch`; PR descriptions; CI of weekend commits | BLOCKED — EXTERNAL DEPENDENCY (GitHub tools disconnected, HTTP 503). Branches are pushed. |
| Production checks from this sandbox | BLOCKED — EXTERNAL DEPENDENCY (proxy refuses the host). Use the GitHub workflows. |
| Stock SQL suite via the repo's Docker script | Not runnable here (no Docker). The same SQL tests passed on local PostgreSQL 16; CI runs PostgreSQL 17 |
| Second Monday check-in (14:35 UTC, other session) | BLOCKED — OWNER ACTION (recommend disabling; it can re-dispatch; slot leases still prevent duplicate orders) |
| Chat per-IP rate limit | Open, low–medium; after Monday |
| Hourly backups still single points at documented timing | Residual risk (§9) |

## 13. Monday instructions

**Sunday 18:00 UTC (11:00 AM MT): the freeze. Owner first.**
1. **Merge only what you approved.** Suggested order:
   1. #157;
   2. update #159 / #160 / UX / CLOCK_SKEW from `main` and merge;
   3. #158 only if you decided "before Sunday".

   Never #102.
2. **Run the freeze check.** Actions → *Experiment freeze check* → Run workflow. Expect green. Production = `main`; #102 pinned.
3. **Take the snapshot.** Ask me (or run) `node --experimental-strip-types scripts/experiment-manifest.mjs snapshot docs/experiments/manifest-2026-11-15-freeze.json` on `main`, then commit it. Its timestamp is the real freeze time.
4. **Run the other workflows.** Dispatch *Operations monitor* (14 of 14 green) and *Props activation preflight* (all PASS).
5. **No merges after this until Monday's after-close mark.**

**Monday Nov 16 (all times Mountain).**

| Time (MT) | What to do | Expected screen |
|---|---|---|
| 7:00 | Open https://sports-edge-eta.vercel.app/stocks/paper-auto → paste the owner key → **Unlock** | Autopilot headline **Planning only**. That is the armed state while `main` keeps broker writes off; orders come only from the release-branch execute. Start is disabled because the gate is already armed: **do not press Start.** **Stopped** or **Needs attention** here is a NO-GO: read its reasons. |
| 7:00 | Check the decision | *TARGETS* for 2026-11-16. If **HOLD**, **MISSED** or no decision: a valid no-trade day. Stop here; nothing is wrong. |
| 7:38 (14:38 UTC) | The guarded check-in dispatches one execute on `release/stock-paper-orders` | Its report says `posts>0` and `ORDERS_COMPLETE` or `ORDERS_WORKING` |
| 7:45–8:30 | Confirm genuine fills | Autopilot "Risk and execution" shows intents **filled** with broker order IDs, and positions match. **Only this, or the Alpaca PAPER dashboard showing the same orders, proves a genuine PAPER fill.** A green workflow, a shadow plan or HOLD is not a fill. |
| After fills, before 1:40 PM | Press **Stop autopilot** → confirm. Then **Start** (or **Start on GitHub** if shown) | Stop: headline **Stopped**, working orders cancelled. Start: refused unless the reconcile is clean; then back to **Planning only** (armed) |
| After 2:00 PM close (~2:35–4:00 PM) | Wait for the after-close monitor | `DAILY_RECORDED`, cash reconciled. **That is the proof the close mark succeeded**, shown on the Autopilot page and in the ops monitor's `stockGate` |
| After 4:00 PM | Dispatch *Operations monitor* | `stockGate` passes; the watcher then merges #102 within its hourly run (or dispatch *Independent PAPER release checks* → `release`) |

**If anything fails:**
- **Stop safely:** press **Stop autopilot**. It cancels working strategy orders and sends nothing new.
- **Don't retry:** never re-dispatch an execute whose outcome is unknown, and don't press Start after a failure until the page shows a clean reconcile.

**Do not press Start when:**
- the headline is Planning only, Running or Trading now (already armed);
- there are unresolved submissions or a critical alert;
- the account is not clean;
- it's after 1:40 PM MT (the 20-minute cutoff).

**Success:**
- real PAPER fills match the plan;
- Stop and Start both work;
- the close mark is recorded and reconciled;
- no duplicate orders;
- `realMoneyEnabled` stays false.

## 14. Next phase (prioritised backlog)

1. **Evidence-based challenger promotion (sports):**
   - apply the lab SQL;
   - run the pre-registered More-side recalibration and book-agreement challengers as frozen lab forecasts;
   - promote only through the existing gate.

   Needs: owner SQL plus 4–8 weeks of slates.
2. **Data enrichment:** sportsbook quotes at the same line for every pick (the "no book quote" picks hit 14 of 33); injury/minutes news as a feature. Free sources first. Any paid data needs your approval.
3. **Conversational AI:**
   - keep the deterministic router as the safety layer;
   - add an optional language model *only* to phrase answers over the same records, behind a feature flag, with a cost cap and your approval;
   - no new actions without owner confirmation.
4. **Autonomous internet research:** activate `discovery.ts` in read-only, rate-limited mode (OpenAlex/arXiv) into append-only research memory. Hypothesis cards reach the lab only as pre-registered specs. Nothing touches active models.
5. **Stock challengers:** survivorship-free universe data; then re-test, since all current candidates fail.
6. **Ops:**
   - a per-IP chat rate limit;
   - a second independent backup path (e.g. Supabase cron) to remove single-backup dependence;
   - the production RLS check automated through an RPC.

**Fastest responsible route:**
1. Monday succeeds and #102 releases.
2. Apply the lab SQL that week.
3. Run items 1 and 2 in parallel for 4–6 weeks of forward evidence.
4. Add item 3 behind a flag.
5. Item 4 last.

No step promotes anything without frozen forward evidence and your approval.
