# Release recommendation and remaining checklist (final, 2026-11-25)

Prepared by Claude for the owner. ChatGPT owns Kalshi paper-testing automation, production verification and
automated tracking receipt checks; nothing here duplicates that work.
- **Production main:** `8c03239` (#213, #218 and #220 deployed).
- **This is a recommendation, not an approval.** Nothing here merges, migrates, dispatches orders or activates trading.
- **No research, model, gate, sample-minimum or cadence change** is included.

**Finish line (Nov 30, core development complete)** means operational readiness, Part A. Algorithm validation
(Part B) runs on its own evidence clock and does **not** move that finish line.

## 1. PR decisions

| PR | Head | Decision | Why |
|---|---|---|---|
| **#224** (ChatGPT) | `7953351` | **Merge now** | Independent review posted. Offline step reproduces exact totals, receipt deterministic, 0 network requests, read-only permissions, no secrets, 8/8 checks, clean with main and every candidate. Follow-up (not blocking): register `kalshi-paper-verify.yml` in `config/ops/jobs.json` |
| **#217** | `0f2def9` | **Merge and deploy before Sunday evening** (approves 2 crons) | Nov 30 checklist and schedule recovery. No gate, risk, cadence or frozen-file change; duplicates are refused by the controller |
| **#221** | `b483430` | **Merge now** | Traces every NBA prediction of every model; props research only |
| **#222** | `3ca976d` | **Merge now or after Nov 30; not inside the freeze** | Now proven not to affect the #102 gate (section 3) |
| **#219** | `32f8e97` | Merge any time | Research record only (docs, scripts, registry); never production |
| **#223** | this | Merge any time | Docs only |
| **#102** | `9e23e63` | **After** `STOCK_SUPERVISED_SESSION_VERIFIED` | The gate itself requires it |
| **#216 → #208** | `e0b86c2` → `4462f09` | **After Nov 30**, with the gates in section 2 | Starts NBA shadow writes and study recording |

**Close as superseded** (no merge):
- **#211, #214, #215:** superseded by merged #218.
- **#192, #195, #199, #200, #201, #202, #205, #206, #207:** contained in #208/#216. Close when #208 merges.
- **#187:** stale. Its Nov 23 plan is past, and its remaining 6 files would revert newer main code.

**Owner's call** (not claimed as superseded):
- **#196:** ChatGPT's round 4, result FAILS. Merging it records the negative finding.
- **#171, #179, #186, #204:** older and only partly overlapping.

## 2. NBA expanded prediction tracking (#208 + #216 + #221)

The combined tree (main `8c03239` + #216 + #221, `cdf55fa`) merges with no conflicts.

**Tests**
- Props, lab, engine, research and props-server suites: **322 passed, 0 failed**. The 10 skipped are database tests, which run in the SQL harness.
- The full five-way integration (tree `253f4b9`) still stands: Node 1,175/0, SQL 9 suites with 18 readiness cases and 10 integration tests, Python 470, build OK.

**Shadow predictions are traced:** a frozen monotone-shadow prediction (`props-nb-monotone-cal-v1`) traces as `TRACEABLE`:
- it appears as its own model in `byModel`;
- it shows graded or pending outcomes;
- it is listed as `undecided`, because shadows are never picked.

**Production improvements are preserved.** #216's `research-engine.ts` keeps #220's `advance()`, coverage and alarms beside #208's shadow tracking.

**Manifest:** stock drift is zero. Props drift is in `props-cycle.ts` (#208's additive shadow hook) and in `capture-plan.ts`/`props-tick.ts` (already on main).

**Gates before merge:**
1. Re-run hosted readiness from #216's head and confirm 13 rows with `OVERALL = READY`.
2. Acknowledge the `props-cycle.ts` drift, and take a new manifest snapshot after the merge.
3. Merge only outside the freeze (section 5).

## 3. #222 does not interfere with Nov 30

- `scripts/paper-release-gates.mjs` reads the ledger through `parseLedger`. #222 adds only `decisions[].rejected`, which the gate never reads, and its parser cannot throw on JSON input.
- **Differential run:** main's gate and #222's gate were run on 252 ledgers: the passing fixture and 17 failing mutations, each with 14 diagnostics shapes (missing, null, array, string, malformed, oversized). Results were identical, and the parsed ledgers were identical apart from the new field.
- **Committed proof:** `scripts/paper-release.test.mjs` (`3ca976d`) asserts that the gate result is unchanged under odd diagnostics, for one passing and two failing ledgers. It passes locally with the full file, 166/166 across the stock, gate and ops suites. Hosted CI does **not** run it, because the *Independent PAPER release checks* workflow is `disabled_manually` along with the expired watcher. #222's 7 hosted checks are green.
- **Merge timing:** safe before Sunday evening or after Nov 30. As with any deploy, not inside the freeze.

## 4. Stock scheduling (no duplicate orders, no bypassed controls)

- **Cause:** GitHub's stock crons start hours late. On-time work already comes from Vercel backups:
  - decision dispatched at 09:xx UTC;
  - execute at 15, 16 and 18 UTC;
  - monitor at 22 UTC.
- **#217 closes the two remaining single points of failure:**

| Backup | When | Duplicate protection |
|---|---|---|
| `stock-decision-backup` | 10:xx UTC | Skipped if today's kickoff run succeeded or is still queued or running. `initial:'false'`. The database allows one decision per session |
| `stock-monitor-late` | 01:xx UTC, same New York evening | A repeat returns `SLOT_ALREADY_FINISHED` |

- **No execute is added.** On Nov 30 the execute is owner-dispatched. Orders stay behind the owner-armed gate, the release manifest and the close−20 min refusal.
- The ops line `stock-worker: MISSED_SLOT` describes GitHub's own cron slots, not lost sessions. #217's checklist says so.

## 5. Learning-engine data completeness

Latest production run: `45549736401-1`, at 04:52 UTC Nov 25, on main.

| System | Predictions | Outcomes | Performance | Status |
|---|---|---|---|---|
| **NBA baseline** | 767 clean ledger rows | 1,054 scored, 1,054 locked, 1,023 graded, **0 overdue**, 0 contradictory | 168 picks at 58.9% (Wilson upper 66.1%); confidence gap +6.1 points (95% CI −3.1 to +15.3) | **Complete.** Alarms OK, drift and coverage reported |
| **NBA shadows** | `props-learn-v1/v2-shadow` paired | same ledger | forward pairing | Complete; `INSUFFICIENT_DATA` until the registered sample is met |
| **NBA monotone shadow** | written only after #208 merges | traced by #221 | tracked by #216's `trackMonotoneShadow` | Starts at #208 merge |
| **Stocks (PAPER)** | ledger and daily marks exist | — | SPY comparison exists (main; #222 at matched exposure) | **Not fed to the engine.** No producer for `--stock-weeks` |
| **Kalshi** | its own forecast and grade store (4 forecasts, 2 grades) | — | — | **Not an engine domain.** Graded by ChatGPT's pipeline |

**The stock producer is not a Nov 30 item.** The engine's stock rule needs at least 26 forward weeks, which cannot exist before about late May 2027. Feeding the owner-only ledger into the engine workflow also needs a reviewed secret-access change.

Schedule it as post-acceptance integration (Part B). Until then, stock evidence lives in the PAPER ledger and the ops `stockGate`.

## 6. Remaining release checklist

### Part A: operational readiness (the Nov 30 finish line)

**By Sunday Nov 29, before evening**
1. [ ] Merge #224.
2. [ ] Merge #221.
3. [ ] Approve #217's two crons, then merge #217 and confirm the Vercel deploy is live. If you don't approve the crons, use the manual fallbacks in `docs/STOCK_PAPER_SESSION_2026_11_30.md`.
4. [ ] Optional: merge #222, #219 and #223. If not done now, do them after Nov 30.
5. [ ] **Freeze.** No merge or deploy from Sunday evening until the gate reads verified.

**Monday Nov 30** (follow the #217 checklist)

6. [ ] The decision reads `TARGETS` for 2026-11-30. `initial` is not reused.
7. [ ] Owner dispatches execute on `release/stock-paper-orders` at `9e23e63`. The receipt shows `posts > 0`, and both actor and triggering actor are the owner.
8. [ ] Fills recorded, then owner Stop and Start, with a `CLEAN` reconcile in between.
9. [ ] Same-session mark inside a monitor run, between 16:15 ET and New York midnight.
10. [ ] Run the operations monitor. `stockGate.reason` must read `STOCK_SUPERVISED_SESSION_VERIFIED`.

**After the gate is verified**

11. [ ] Review and merge #102 at `9e23e63`. Merge #222 if you held it.
12. [ ] Re-run hosted readiness from #216's head. If it reads READY, merge #216 into #208, then #208. Acknowledge the drift and take a new manifest snapshot.
13. [ ] Run the *Forward paper studies* preflight. ChatGPT confirms production receipts.
14. [ ] Close the superseded PRs in section 1.

**Core development is complete when 1–14 are done.** No other development task is required for Nov 30.

### Part B: long-term algorithm validation (separate clock, not a release blocker)

- **NBA monotone shadow and `props-learn` shadows:** forward evidence until the registered sample minimums are met. The engine requests owner review; it never promotes on its own.
- **#219 challengers** (opponent rate, low minutes): `PROMISING` on retrospective evidence only. They need a frozen forward shadow before any review.
- **Stock strategy:** 26+ forward weeks against matched-exposure SPY. Add the `--stock-weeks` producer as reviewed integration work before then.
- **Kalshi:** 30 pairs and 50 holdout, unchanged. ChatGPT owns it.
- **Ops follow-ups** (ChatGPT): add `kalshi-paper-verify` to `config/ops/jobs.json`.
- **Next props release:** consider the frozen-file guard in `rules.ts` (`Number.isFinite`), from the fail-closed audit.
