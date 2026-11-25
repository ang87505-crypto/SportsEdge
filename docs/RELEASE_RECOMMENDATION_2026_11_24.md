# Consolidated release recommendation: stock and NBA operational acceptance (updated 2026-11-25)

Prepared by Claude for the owner. ChatGPT owns Kalshi paper-testing automation, production verification and
automated tracking receipt checks; nothing here duplicates that work.
- **Production main:** `8c03239`, which includes the deployed tracking and learning fixes #213, #218 and #220.
- **This is a recommendation, not an approval.** Nothing here merges, migrates, dispatches orders or activates trading.
- **No new research and no promotion-rule changes** are included.

## 1. Release candidates (all updated onto main `8c03239`; every pair merges cleanly)

| PR | Head | Scope | Affects Nov 30 acceptance? | Recommendation |
|---|---|---|---|---|
| **#217** | `0f2def9` | Nov 30 checklist with verified schedule table and fallbacks; schedule recovery: `stock-decision-backup` (10:xx UTC weekdays; skipped if today's kickoff run is queued, running or succeeded; `initial:'false'`) and `stock-monitor-late` (01:xx UTC Tue–Sat, same New York evening; controller answers repeats `SLOT_ALREADY_FINISHED`). 4 files | Yes, it *protects* it. No gate, risk, cadence, release-flag or frozen-file change | **Merge and deploy before Sunday evening**, if you approve the two added daily crons. Otherwise use the manual fallbacks in the checklist |
| **#221** | `b483430` | Every NBA prediction of every model, picked or not, traced to frozen line, confidence, model and outcome; overdue outcomes; research-receipt field | No: props research only | **Independent; can release any time** |
| **#222** | `5c4305b` | Stock tracking: SPY at matched exposure, turnover, costs, rejected candidates, decision-to-fill reconciliation | **Touches `paper-auto-ledger.ts`, which `scripts/paper-release-gates.mjs` reads to evaluate #102's gate** | **Hold until after the Nov 30 gate reads `STOCK_SUPERVISED_SESSION_VERIFIED`** |
| **#216** (into #208) | `e0b86c2` | #208 forward-study release (frozen NBA monotone shadow, paper studies, readiness SQL, replay) plus main and the shadow before-lock readiness row | No stock files | **After Nov 30**; see the gates below |
| **#219** | `32f8e97` | NBA research record: breakdown; opponent and low-minutes challengers (both PROMISING, retrospective only) | No | Any time; docs, scripts and registry only, never production |
| #223 | this | This recommendation | — | Docs only |

## 2. Verification

**Final local integration** on main `8c03239`, merged in the order #217 → #222 → #221 → #216 → #219, tree `253f4b9`:

| Suite | Result |
|---|---|
| Node (props, lab, engine, research, stocks, Kalshi, command, assistant, ops, release) | **1,175 passed, 0 failed**; 10 props database tests run in the SQL harness |
| Disposable PostgreSQL: 9 contract suites, 18 readiness cases, 10 integration tests (daily cycle, capture ticks, shadow accepted once and lock-crossing write refused) | all pass |
| Stock controller and worker end to end (PostgreSQL, not skipped), command ledger PostgreSQL, release gates, ops monitor | pass |
| Python | 470/470 |
| ESLint / `next build` | 0 errors (8 warnings: 6 existing plus 2 in #218's NOAA tests) / passed |
| Experiment manifest | stock drift **zero**. Props: `capture-plan.ts` and `props-tick.ts` (pre-existing on main) and `props-cycle.ts` (#208's shadow hook, additive) |

Hosted CI for each final head is recorded in the PR descriptions. Synthetic database tests are not hosted readiness.

## 3. NBA forward-testing release (#208 + #216)

- **Preserves #213, #218 and #220.** It is a clean merge with main. `scripts/research-engine.ts` keeps #208's
  monotone-shadow tracking alongside #220's `advance()`, coverage and review-only alarms.
- **Hosted readiness still applies.** Your 13-row `OVERALL = READY` result matches #216's query (hash `90a2a5d0…`;
  #208's original query returns 12 rows). The main merge changed no database file, and the setup bundle and schema
  files are identical to #208's. It is a point-in-time reading, so **re-run it immediately before merge**.
- **Behaviour verified by tests:**
  - **Recording:** every captured line gets a frozen baseline forecast, and the shadow writes only new baseline rows.
  - **Line provenance:** the observation is append-only, with lock and hash evidence.
  - **Grading:** revisions are kept, and an earlier clock sees the original grade.
  - **Duplicate protection:** unique (observation, model), first frozen forecast wins, uncertain writes never retried.
  - **Before-lock refusal:** enforced by the database, plus readiness gating of the trigger.
  - **Learning-engine integration:** monotone shadow tracking, and PROPOSED transitions via `advance()`.
- **Gates before merge:**
  1. readiness re-run reads READY;
  2. you acknowledge the `props-cycle.ts` frozen-file drift and take a new manifest snapshot after merge;
  3. not between Sunday evening and the Nov 30 after-close mark.
  
  Merging starts NBA shadow writes and scheduled study recording. Then run the *Forward paper studies* preflight;
  production confirmation is ChatGPT's.

## 4. Stock system verification (code, tests and Nov 16–24 run logs)

| Area | Status |
|---|---|
| Decision generation | Vercel kickoff dispatched at 09:16 UTC every weekday. `TARGETS` was recorded at 13:00 UTC on Nov 16 and Nov 23, with quiet `NO_DECISION_THIS_SESSION` on other days. A late GitHub run (22:40 UTC Nov 23) was refused (`REFERENCE_CAPTURE_TOO_LATE`, then `SLOT_ALREADY_FINISHED`), so there was no overwrite. Nov 30 is the only session the bridge admits; `initial` is spent |
| Daily performance records | `DAILY_RECORDED` at 22:32 UTC (Vercel backup) on every session day Nov 16–24; late GitHub monitors skipped as duplicates |
| Benchmark comparison | Main: SPY 100% over verified marks (`forwardPerformance`). #222 adds SPY at matched exposure, which is the comparison that matters (after Nov 30) |
| Reconciliation | Owner Start runs a fresh reconcile; the gate needs CLEAN between Stop and Start (controller e2e). #222 adds per-symbol decision-to-fill |
| Learning-engine inputs | **Gap.** The engine accepts weekly stock rows (`--stock-weeks`: strategy, SPY, exposure; needs ≥ 26 weeks), but **no workflow produces them from the PAPER ledger**. Forward stock evidence does not reach the engine automatically. Wiring it is integration work, and it needs the owner-only ledger in the engine workflow |
| Missed schedules | GitHub's stock crons fire hours late (executes after the close; monitors 01:41–04:56 UTC). The **on-time work is done by Vercel backups**. Ops `stock-worker: MISSED_SLOT` reflects GitHub slots only. #217 removes the two single points of failure (decision kickoff, close mark) |

## 5. Superseded and stale PRs

| PR | Status |
|---|---|
| #211, #214, #215 | **Superseded by merged #218.** Main holds their content, and later extensions of the remaining files (#218's midnight tests and docs; the #220 merge into the ops monitor) |
| #192, #195, #199, #200, #201, #202, #206, #207 | **Contained in the #208/#216 candidate** (git ancestors). Close when #208 merges; do not merge separately |
| #205 | Its readiness SQL is superseded by #216's stricter query; its cross-review docs travel with #208. Close with #208 |
| #187 | **Stale:** its Nov 23 plan is past, and 13 of 19 files already landed elsewhere. The other 6 would revert newer main code |
| #196 | ChatGPT's pre-registered round 4 (cash-aware sizing **FAILS**). My Nov 24 round 4 duplicated it, so I **removed it from #217**. My `current-fill` REJECTED confirms #196; both records are preserved (mine on `claude/elegant-goodall-pzgn4a`, `a62defd`/`e27a6d6`/`392673c`). Merging #196 is the owner's choice |
| #186, #204, #171, #179 | Older and only partly overlapping. Not claimed as superseded; owner or ChatGPT review |

## 6. Genuine remaining blockers

1. **Nov 30 acceptance** (owner, `docs/STOCK_PAPER_SESSION_2026_11_30.md` in #217):
   - decision `TARGETS`;
   - owner-dispatched execute on `release/stock-paper-orders` at `9e23e63` with `posts > 0`;
   - fills, then Stop/Start with a CLEAN reconcile;
   - same-session mark, then `STOCK_SUPERVISED_SESSION_VERIFIED`, then a manual #102 review.
2. **Approval to deploy #217's two crons** before Sunday evening. Without them, the manual fallbacks apply.
3. **#208 + #216 release:** a fresh hosted readiness run reading READY; drift acknowledgement; after Nov 30.
4. **Stock learning-engine input:** no producer of weekly forward rows exists. This is an integration item.

## 7. Owner checklist (order)

1. Approve and merge **#217** (and deploy) before Sunday evening, or keep the manual fallbacks.
2. Merge **#221** any time.
3. Monday Nov 30: run the acceptance checklist.
4. After `STOCK_SUPERVISED_SESSION_VERIFIED`: review and merge **#102** at `9e23e63`, then **#222**.
5. Re-run hosted readiness from #216's head. If READY, approve **#208 with #216**, acknowledge the drift, and take a new
   manifest snapshot.
6. Merge **#219** (research record) and **#223** any time.
7. Close the PRs listed as superseded above.
