# Consolidated release recommendation: research and paper-performance tracking (2026-11-24)

Prepared by Claude for the owner and ChatGPT, which owns collection reliability, tracking integration and release
verification.
- Main at writing: `d9a79a1`. #213 and #218 were merged by the owner at 21:23 and 21:28 UTC.
- **This is a recommendation, not an approval.** Nothing here merges, migrates, dispatches, orders or activates
  trading.

## 1. Status of every open candidate

| PR | Head | What it does | CI (final head) | Risk to production | Recommendation |
|---|---|---|---|---|---|
| #220 | `a1b7eb5` | Learning engine: fixes PROPOSED transitions that failed and reverted whole runs; surfaces silent safety-brake failures in the ops monitor; adds review-only absolute alarms (overconfidence, accuracy below break-even, missing or contradictory outcomes, stale predictions or outcomes, drift) | 9 passed, 2 skipped | Low: engine report and ops monitor only, review-only | **Merge first** |
| #221 | `1ab5f540` | Forecast trace: every prediction of every model, picked or not, traced to its frozen line, confidence, model and outcome, with OVERDUE outcomes and named integrity breaks; adds a research-receipt field | 8 passed, 1 skipped | Low: extra read-only Supabase GETs in the research workflow; no paid API | Merge after #220 |
| #222 | `5ccd2761` | Stock tracking: SPY at matched exposure, turnover, costs (assumed plus fill versus limit), rejected candidates, decision-to-fill reconciliation; lenient ledger parse of rejected candidates | 7 passed | Low, but `paper-auto-ledger.ts` is read by #102's gate evaluation. Controller e2e and release-gate tests pass | Merge **before Sunday evening or after the Nov 30 close mark**, never during the session |
| #217 | `d1a2f733` | Stock round 4 (pre-registered; fill REJECTED, hold-buffer fill below matched SPY) and the Nov 30 checklist | 7 passed | None: analytics, docs and registries only | Merge any time, **before #219** |
| #219 | `32f8e97d` | NBA: error breakdown; opponent challenger (QUALIFIES, −0.00031 Brier); low-minutes challenger (QUALIFIES, −0.00138 Brier); both PROMISING, retrospective only | 7 passed | None: research scripts, docs and registries | Merge after #217; needs a **trivial registry rebase** (both append to `research/engine/registry.json`) |
| #208 + #216 | `4462f09` + `2cfeaa6` | Forward-study release: frozen NBA monotone shadow, paper studies, readiness SQL, replay; #216 integrates main and gates the shadow's before-lock trigger | 12 and 13 passed (5 main-only skips each) | **Medium:** merging starts NBA shadow writes and scheduled study recording | **Last.** Only after hosted readiness is `OVERALL = READY` (including the shadow row) and the owner acknowledges the frozen-file drift (`props-cycle.ts`). Not during the Nov 30 session |
| #211, #214, #215 | — | Contained in merged #218 | — | — | Owner may close as superseded |

## 2. Integrated verification (local, synthetic data)

The full sequence was merged locally on main `d9a79a1`: #216 (which contains #208), #220, #221, #222, #217, #219, with
the one registry conflict resolved by keeping both appended entries. Results:

| Suite | Result |
|---|---|
| Node (props, lab, engine, research, stocks, Kalshi, command, assistant, ops, release) | **1,174 passed, 0 failed**; 10 props database tests skipped there and run in the SQL harness below |
| Disposable PostgreSQL (props contracts, 18 readiness cases, props/tick/shadow integration) | all pass, 10/10 integration tests |
| Command ledger PostgreSQL (`COMMAND_PG_TEST=1`) | 4/4 |
| Stock controller and worker e2e (PostgreSQL, not skipped), release gates, ops monitor | pass |
| Python | all pass (480 at the first integration run) |
| ESLint / `next build` | 0 errors / 51 pages built. 8 warnings: 6 existing plus 2 unused variables in #218's NOAA tests (cleanup for ChatGPT) |

**Experiment manifest:** stock files show **zero drift**. Props drift: `capture-plan.ts` and `props-tick.ts` drift on
main already; `props-cycle.ts` drift comes from #208.

Synthetic tests are not hosted readiness, and green CI is not operational evidence.

## 3. Tracking coverage after these PRs

| Requirement | Where |
|---|---|
| Every NBA prediction, picked or not, traced to frozen line, confidence, model, outcome | #221 `forecast-trace.ts`. Before this, the research snapshot covered only the baseline model and v1 picks |
| Missing outcomes | #221 (per prediction, OVERDUE after 36 h) and #220 (engine coverage plus `MISSING_OUTCOMES` alarm) |
| Overconfidence, declining accuracy, stale data, deterioration | #220 `sports-alarms-v1` plus the existing drift rule; review only |
| Silent safety-brake failure | #220, ops blocker `props-safety-brake-unverified` |
| Stock benchmark, drawdown, turnover, costs, rejected candidates, decision-to-fill | #222, alongside the existing `evaluateStockForward` funnel and round trips |
| NOAA evidence integrity and training gate | merged #218 (30-pair and 50-holdout minimums unchanged; pinned replay reproduced, digest `a29543a9…`) |

## 4. Research findings (no production change)

- **NBA:** two pre-registered challengers qualify for forward testing on untouched seasons and add together:
  - opponent: −0.00031 Brier;
  - low expected minutes: −0.00138 Brier, under-15-minute bias about −9 → −3 points.
  
  Neither alone reaches the production `REVIEW_GATE` (−0.002 upper 95%). **Next step (owner decision):** one
  combined, re-calibrated challenger as a forward shadow on real lines. Production stays frozen.
- **Stocks:** no stock-selection variant (rounds 1–4) beats SPY held at the same exposure. The live weekly rules stay
  unchanged. A passive-core study is the evidence-led next registration (owner decision).
- **Negative results are preserved:** current-fill is REJECTED; earlier rejected strategies stay in both registries.

## 5. Owner checklist

1. Review and merge, in order: #220 → #221 → #217 → #219 (after its rebase) → #222 (outside Nov 30's
   Sunday-evening-to-close window).
2. Run `database/props/checks/forward_studies_readiness.sql` from #216's head, read-only, in the active props project.
   Require every row READY, including `shadow | props_predictions`, and `OVERALL = READY`. Any hosted migration needs
   separate approval.
3. **Nov 30:** follow `docs/STOCK_PAPER_SESSION_2026_11_30.md` (in #217):
   - confirm a `TARGETS` decision;
   - run the owner-dispatched execute on `release/stock-paper-orders` at `9e23e63`;
   - wait for fills, then Stop/Start with a CLEAN reconcile;
   - confirm the same-session mark (manual monitor fallback from 2:15 PM MST);
   - `STOCK_SUPERVISED_SESSION_VERIFIED`, then a manual #102 review.
   
   **Do not use `initial`.**
4. After the session, and only with readiness READY: approve #208 with #216, acknowledge the `props-cycle.ts`
   manifest drift, and immediately run the Forward paper studies preflight. Confirm real record receipts and before-lock
   shadow rows before calling it operational.
5. Close #211, #214 and #215 as superseded by #218, if desired.

## 6. Requests to ChatGPT (integration and release verification)

- Wire `forecastTrace.state` (#221), `report.domains.sports.alarms` (#220) and `stockResearchTracking` (#222) into
  the operations monitor and release verification. These PRs deliberately stop at the pure layer plus receipts.
- After #217 merges, rebase #219's registry append; I can do this on request.
- Optional cleanup: 2 unused-variable lint warnings in the NOAA tests merged with #218.
