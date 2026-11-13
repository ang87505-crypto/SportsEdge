# SportsEdge Friday completion (Nov 13, 2026, finished ~04:10 UTC)

Status labels: **VERIFIED COMPLETE**, **IMPLEMENTED, NOT VERIFIED**, **BLOCKED — OWNER ACTION**,
**BLOCKED — EXTERNAL DEPENDENCY**, **INCOMPLETE**. Simulated means a fake broker and an isolated database, never
Alpaca. Passing tests do not show that any strategy is profitable.

## 1. Executive summary

- **Friday's engineering work is done.** What remains needs you, or needs Monday's real session.
- **PR #157: READY_FOR_OWNER_MERGE.** Diff reviewed line by line; no defect found. All checks were green on `3b99aa3`;
  the later commits add only read-only tooling and docs, and their CI is listed in §11.
- **Sports calibration, from the real ledger with each line counted once:**
  - Recorded picks hit **37 of 61 (60.7%)** against **64.9%** stated confidence. The gap is +4.2 points with
    z = 0.69, so the evidence does **not** show overconfidence at this sample size.
  - Probability skill across all 205 scored lines is close to a coin flip (Brier 0.2478, log loss 0.6887).
  - The model **leans toward More**: it averages 46.2% for More, but More happened 42.0% of the time. More picks
    hit 7 of 16.
  - My earlier figure, "81 graded, 58%", **double-counted** lines picked on both platforms. This audit corrects it.
- **Stocks:** every challenger that has been judged FAILS its pre-registered gate. The **active weekly strategy**
  returned **6.0% a year in the 2023+ holdout against 10.5% for exposure-matched SPY**. It stays unchanged; Monday
  tests execution, not edge.
- **Monday:** all 90 stock controller, broker, risk, worker, owner and performance tests pass on #102's pinned head
  (simulated broker). As of the 02:43 UTC monitor run, the gate reason was still `STOCK_SUPERVISED_EXECUTE_REQUIRED`:
  ARM and the clean account check already pass. **On track.**
- **New risk, now quantified:** Vercel's documentation says Hobby crons fire anywhere inside their hour. Under that
  timing, today's odd-hour backups leave **26–37% of anchor tip times** without a guaranteed capture whenever GitHub
  drops its own runs. **Draft PR #158** (hourly backups, 28 of 100 crons) closes it and needs your approval.
- **Security:** one low-severity defect fixed, in PR #159: a constant-time token check for `data-health`. The
  read-amplification fix is in #157. The production RLS check still needs your SQL run.

## 2. Repository and production

| Item | Value |
|---|---|
| `main` / production | `198b27f` (ops monitor 02:43 UTC: production matches main, 14 of 14 live checks) |
| PR #157 head | Latest commit on `claude/beautiful-knuth-6qw5zi` (docs/tooling; §12) |
| PR #102 | Draft, unmerged, head `9e23e6305eb04bc20ea7e393bd2c49da4bd2a811` (unchanged) |
| New PRs | [#158](https://github.com/ang87505-crypto/SportsEdge/pull/158) (draft, schedules), [#159](https://github.com/ang87505-crypto/SportsEdge/pull/159) (security) |
| Supabase | Props `vfyzbliksooljxrlfadp`: capture schema applied; lab schema **NOT_APPLIED** (preflight [43357624566](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43357624566)) |

## 3. PR #157 review verdict: **READY_FOR_OWNER_MERGE** (VERIFIED COMPLETE)

| Check | Result |
|---|---|
| Required CI on `3b99aa3` | All 6 workflows green (browser QA, build/audit, props verify, verify, assistant, dual-track) |
| `/lab` phone overflow | Fixed at the root; `/lab` is exactly 320, 390 and 768 px wide at those widths; smoke 52 of 52 |
| Public chat cache | Five public questions → one ledger read (test) |
| Accounting identity | Tests pass; real ledger `IDENTITY_OK` on all accounts |
| Lab preflight | Real ledger: `NOT_APPLIED`; unit tests cover APPLIED, NOT_APPLIED, UNKNOWN and FAIL (tampering) |
| Experiment manifest | Verify `FROZEN_MATCH`; drift drill detects protected changes (§10) |
| Research intake/discovery | Inactive; a test proves no fetch, env, store, rule, budget or schedule access |
| Active predictions, staking, risk, budgets | Untouched: none of the 23 frozen files differ from `main` |
| Security regressions | None found. The shared cache can let two simultaneous requests both load once when it is empty (no amplification) |

## 4. Learning Lab migration readiness: **engineering VERIFIED COMPLETE; BLOCKED — OWNER ACTION** (apply SQL)

**Verified on a scratch Postgres database:**
- the migration and its tests pass (`PROPS_LAB_V1_SQL_TESTS_PASS`);
- a second run fails at the first `CREATE TABLE` and rolls back, with identical row counts and 43 triggers before and after;
- it creates only `props_lab_*` objects, with RLS on and `service_role` SELECT/INSERT only;
- it contains no statement touching paper tables.

**Freezing:**
- the database sets each forecast's time;
- forecasts are refused at or after lock, with data newer than lock, once a result exists, or under an unregistered spec hash;
- shadow stakes are refused after lock or settlement;
- every lab table is append-only.

**Isolation:**
- the worker writes only `props_lab_*` tables;
- it makes no provider calls and has no path to picks, entries, the model or stakes;
- it reports `NOT_MIGRATED` and exits cleanly when the tables are absent;
- the tick step is `continue-on-error`.

**Owner procedure:** Supabase → project `vfyzbliksooljxrlfadp` → SQL editor → paste `database/props/props_lab_v1.sql`
→ run once. Then dispatch *Props activation preflight* and expect `lab-schema: APPLIED`, tampered `0`. No historical
lab forecasts are created; evidence starts from the next tick.

## 5. Sports calibration findings: **VERIFIED COMPLETE** (real ledger, run [43361092421](https://github.com/ang87505-crypto/SportsEdge/actions/runs/43361092421))

Model `props-nb-minutes-rate-v1`, selection `props-select-v1`, lines locking from 2026-11-01. Only predictions the
database accepted before lock are used; nothing was reconstructed.

| Measure | Value |
|---|---|
| Unique lines scored | 283 (72 cross-platform duplicates excluded) |
| Graded / ties / void-DNP / not yet graded | 205 / 8 / 3 / 67 (the 67 include the Nov 12 slate, still unsettled) |
| Box-score corrections | 0 revisions, 0 outcome changes |
| All lines: Brier, log loss | **0.2478**, **0.6887** (coin flip: 0.25, 0.693) |
| Calibration-in-the-large | Mean P(More) 46.2% vs More rate 42.0% (leans More) |
| Recorded picks (graded) | **37 of 61 = 60.7%** (95% range 48.1–71.9%) |
| Mean stated confidence | **64.9%** → gap +4.2 pts, SE 6.1, z 0.69: **not distinguishable from calibrated** |
| By confidence band | 60–65%: 24 of 40 (60%); 65–70%: 6 of 11; 70–75%: 4 of 6; 75–80%: 3 of 4 |
| By stat | Points 25 of 41; rebounds 7 of 13; assists 5 of 7 |
| By side | **Less 30 of 45 (66.7%)**; **More 7 of 16 (43.8%, gap +19 pts)** |
| By sportsbook quote at the same line | No quote 14 of 33 (42.4%); books agree 12 of 16; books disagree 11 of 12 |
| By DFS line vs nearest book line | Same as books 23 of 28; no book line 14 of 33 |
| By game | 1 to 11 picks per game; one game (Cavaliers @ Knicks, Nov 12) supplied 10 of 11 hits, so the picks are strongly correlated |
| By player | At most 3 picks per player: anecdotes only |
| PrizePicks expected vs realised (9 entries, known payouts) | Expected +$18.69 (stated probabilities, independent legs) vs realised **$0.00** |
| Accounting | 6 lost × −$5 + 3 won × $10 = $0.00; Pick6's six unknown payouts excluded (ledger audit `IDENTITY_OK`) |

**Assessment:**
- There is no statistically supported evidence of overall overconfidence yet.
- Probability skill is near zero, and the More side looks overconfident.
- Picks without a same-line sportsbook quote did markedly worse. That's the most promising signal, but samples are
  small and correlated by game.

Nothing was changed.

**Most promising challengers (research only):**
1. Calibration (already registered).
2. A book-agreement filter or blend: lab market layer. It needs `props_lab_v1.sql`.
3. A More-side recalibration, pre-registered as a single rule.

## 6. Stock research validation: **VERIFIED COMPLETE**

Sources:
- published research summary 2026-11-12 18:20 UTC (`research-data/summary.json`);
- the results docs (`docs/STOCK_WEEKLY_BACKTEST_ROUND2_RESULTS_2026_11_01.md`, `STOCK_DAILY_STRATEGIES_RESULTS_2026_11_10.md`,
  `STOCK_TOM_RESULTS_2026_11_10.md`).

Costs 10 bps per side unless noted.

| Strategy | Test period | Net CAGR | Benchmark | Max DD | Sharpe | Forward obs | Status | Limitations |
|---|---|---|---|---|---|---|---|---|
| **stock-v2-weekly-1 (active)** | 2017–2026-10-30; holdout 2023+ | 6.5% (full); **6.0% (2023+)** | SPY 14.5%; **exposure-matched SPY 10.5% (2023+)** | −24.4% | 0.55 | 0 sessions with orders | Active, frozen; Monday = first orders | Survivorship-biased universe; $95 cap held it back; underperforms exposure-matched SPY in holdout |
| momentum-quality-paper-v1 | 2017-02–2026-11-06 | 16.4% | SPY 14.5% | −35.1% | 0.73 | 0 (not started) | **FAILS** (drawdown >35%, Sharpe < SPY) | Previously inspected data |
| qmom-disclosure-follower-v1 | Forward only | N/A | N/A | N/A | N/A | 2 sessions (+1.7%) | Insufficient sample | No reliable historical holdings |
| berkshire-13f-top5-paper-v1 | 2017–2026 | 11.3% | SPY 14.5% | −42.0% | 0.63 | 2 sessions (+0.4%) | **FAILS** | 45-day filing lag modelled; concentration |
| daily-reversal5-v1 | 2017-02–2026-11-06 | −12.0% | Exp-matched SPY | −74.7% | −0.67 | 2 sessions (−0.7%) | **FAILS** 8 of 9 | Turnover ~224×/yr |
| daily-momentum5d-v1 | same | −9.0% | Exp-matched SPY | −73.4% | −0.31 | 2 sessions (+0.1%) | **FAILS** 8 of 9 | Turnover ~203×/yr |
| daily-spy-trend50-v1 | same | 6.0% | Exp-matched SPY 7.9% | −19.6% | 0.59 | 2 sessions (0.0%) | **FAILS** | — |
| spy-tom-v1 | 2017–2026 | 1.8% | Exp-matched SPY 4.1% | −12.1% | 0.27 | N/A | **FAILS** | 19% average exposure |
| lab-stock-psychology-v1 (4 layers) | Holdout 2023+ | Base 6.0%; best layer 10.4% | Exp-matched SPY 10.5% | −13.3% (base) | 0.56 (base) | 0 frozen rows (first decision 2026-11-16) | **No clear effect** after Holm | Survivorship-biased universe; four layers untested (no data) |

**Validation checks:**

| Check | Status |
|---|---|
| Chronological split | Development 2017–2022 / holdout 2023+ |
| Look-ahead | Completed bars only; decisions at 08:00 ET on prior closes |
| Delayed disclosure | 13F filing dates; QMOM forward only |
| Costs | 10 and 25 bps |
| Benchmarks | Exposure-matched benchmarks and drawdown gates |
| Multiple testing | Holm correction in the lab |
| Pre-registration | Committed before runs |
| **Survivorship** | **Not controlled**: the universe is survivorship-biased (stated limitation) |
| Selection bias | Partly controlled: some candidates were chosen after inspecting data (stated) |

**Nothing is described as a breakthrough, and nothing was promoted.**

## 7. Monday stock release gate: **VERIFIED COMPLETE (simulated); live session NOT YET**

On `9e23e63`, local real Postgres with a fake broker: **90 of 90** (paper-auto controller, broker, risk, worker, owner,
resume, kickoff, ledger, performance, autopilot view). Python bridge OK. Release-gate tests on `main` 13 of 13.

| # | Scenario | Evidence |
|---|---|---|
| 1 | Valid TARGETS | Controller end-to-end plans, reserves, submits, fills |
| 2 | HOLD | Treated as executable (sells to target); bridge HOLD tests; a HOLD Monday = no gate pass, no forced orders |
| 3 | Missing decision | `NO_EXECUTABLE_DECISION_TODAY` |
| 4 | Late decision | Bridge `MISSED` tests; gate requires the decision recorded before the execute started |
| 5 | Wrong account | `ACCOUNT_IDENTITY_MISMATCH` → STOPPED (controller test) |
| 6 | Unexpected open orders | `EXTERNAL_OPEN_ORDER` |
| 7 | Partial fills | Partial-fill and resting-order paths |
| 8 | Duplicate execution | Duplicate slot delivery does nothing; `LEASE_HELD` |
| 9 | Timeout after acceptance | POST timed out but filled → uncertain → reconciled, never retried |
| 10 | Timeout before acceptance | Lost reply is uncertain and never retried; complete-history lookup |
| 11 | Broker unavailable | Broker adapter error handling; unknown outcomes fail closed |
| 12–14 | Owner Stop / Pause / Start | Stop cancels working orders; `GATE_<mode>` blocks; Start only while stopped, through the reconcile-then-resume workflow |
| 15 | Restart after reconciliation | Resume needs the exact clean reconcile receipt; a later slot re-plans and holds |
| 16 | Risk-limit rejection | `RESERVE_*` refused, all-or-nothing; risk boundary tests |
| 17 | Incorrect cash | Unexplained cash → contaminated mark, stop |
| 18 | Insufficient buying power | Planner sizes on cash minus unsettled proceeds (T+1); risk tests |
| 19 | Stale account snapshot | Every execute reconciles first; the gate requires a clean check within 26 h |
| 20 | Missing after-close prices | Benchmark read failure cannot hide a risk breach; mark retried |
| 21 | Reconciliation discrepancy | `NOT_CLEAN`, unexplained or missing positions |
| 22 | Session close | `OUTSIDE_EXECUTION_WINDOW` (20 min before close); `MARK_WINDOW_PASSED` |
| 23 | Wrong trading date | Next session's decision never executed; marks never back-dated |
| 24 | Wrong model version | Ledger parser refuses unknown model versions; registration exact keys |
| 25 | Changed release branch | Gate accepts only the reviewed PR head, file hashes and green checks |

**Gap:** `CLOCK_SKEW` (broker clock more than 60 s off) is enforced in code but has no test. It can't be added to the
pinned release head without changing it. The risk is low.

**Real money:** `realMoneyEnabled:false` on `main` and `9e23e63`. The ledger parser refuses anything else. No Alpaca
order was sent.

**Cancel or postpone Monday if any of these hold:**
- the gate reason is not `STOCK_SUPERVISED_EXECUTE_REQUIRED` before the session (e.g. `STOCK_ACCOUNT_NOT_CLEAN`, `STOCK_OWNER_START_REQUIRED`);
- an unresolved intent or a critical alert exists;
- #102's head has changed;
- the freeze verify shows `DRIFT` on a stock file;
- the market is closed or the clock is skewed;
- the decision is HOLD, MISSED or absent (a valid no-trade day; don't force orders);
- you're unavailable 7:30 AM–2:00 PM MT;
- the broker returns repeated uncertain outcomes.

## 8. Security findings: **VERIFIED COMPLETE for code; production RLS BLOCKED — OWNER ACTION**

| Severity | Finding | Status |
|---|---|---|
| Medium | Public chat read amplification | **Fixed** (#157, test) |
| Medium | Production RLS and grants unverified for props tables | Run the SQL below |
| Low | `data-health` token compared with plain string equality | **Fixed** (#159, test) |
| Low–Medium | No per-IP rate limit on public chat | Mitigated by caches, 2,000-byte body and 300-character message limits; propose a per-instance token bucket after Monday |
| Info | Other internal routes | `alpaca-paper`, `research`, `collect-markets` and `research-cycle` use constant-time bearer checks and return 404 otherwise; owner routes use the signed session; cron routes use `CRON_SECRET` (live checks 401) |
| Info | Secrets in logs | Scan found no workflow `set -x` or secret echo, and no script printing env secrets |
| Info | Paper/live isolation | Fixed paper host; no redirects; live host unreachable (broker tests) |
| Info | External research content | Untrusted, stripped, capped, flagged; no action path (tests) |

**Read-only RLS check (Supabase SQL editor, project `vfyzbliksooljxrlfadp`):**

```sql
select c.relname, c.relrowsecurity,
  coalesce((select string_agg(grantee||':'||privilege_type, ',' order by grantee, privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema='public' and g.table_name=c.relname
      and g.grantee in ('anon','authenticated','PUBLIC')),'') as public_grants,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'props\_%'
order by 1;
```

**Pass:** `relrowsecurity` true on every row, `public_grants` empty, `policies` 0. Any anon or authenticated grant is
a finding; the fix is `REVOKE ALL ON public.<table> FROM anon, authenticated, PUBLIC;`, applied only with your approval.

## 9. Scheduler reliability: **VERIFIED COMPLETE (analysis); change BLOCKED — OWNER ACTION (#158)**

- **Current state:** `vercel.json` has 21 crons. The Vercel plan allows 100 cron jobs, with Hobby timing anywhere
  inside the hour, per Vercel's docs read today.
- **Deterministic simulation** (`src/lib/props/backup-coverage.ts`, every minute of anchor tip 17:00–04:00 UTC,
  LATE window only, GitHub dropped):

| Backups | Delay 10–38 min | 0–60 min | 0–75 min |
|---|---|---|---|
| Odd hours (current) | 2% not guaranteed | **26%** | **37%** |
| Hourly 13–02 (#158) | 0% | 0% | 0% |

- **Safety:** unchanged. Unique claims, one running run per kind, the database budget (7 per 24 h) and
  unknown-outcome no-retry all still apply. Extra ticks with nothing due spend 0 credits.
- **#158's test:** the realistic coverage test passes, and a second test shows the old set fails it. All JS tests on
  that branch: 659 passed, 0 failed, 40 skipped.

## 10. Experiment freeze readiness: **VERIFIED COMPLETE (tooling); freeze itself BLOCKED — OWNER ACTION (Sunday)**

- **What the manifest pins:**
  - model, selection, payout terms, budget, capture windows, brake and promotion gate;
  - stock registration limits and release flags;
  - the git commit, and SHA-256 of 23 decision files.
- **What it records:** 10 research and scheduling files, recorded but not freeze-breaking.
- **Verify:** the current candidate gives `FROZEN_MATCH`.
- **Drift drill (isolated worktree):**
  - a research-registry edit → `FROZEN_MATCH`;
  - payout table and daily budget edits → `DRIFT`, exit 1, naming both files and the budget setting.
- **Expected and intentional:** merging #158 changes recorded scheduling files only (no drift). Merging #102 after the
  gate flips the stock release flag, which starts a new cohort.

## 11. Test results (local, final #157 head)

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| All JS/TS tests | 688 | 0 | 40 (need live Postgres or broker flags; Monday-relevant ones run below) |
| Python research | 100 | 0 | 0 |
| Python analytics | 423 | 0 | 0 |
| Props SQL migrations (7 suites) + integration | 7 + 9 | 0 | 0 |
| Stock suites on `9e23e63` (real Postgres, simulated broker) | 90 + bridge OK | 0 | 0 |
| Release-gate tests | 13 | 0 | 0 |
| TypeScript | exit 0 | — | — |
| ESLint | 0 errors | — | 3 pre-existing warnings |
| Production build | OK | — | — |
| Browser smoke (desktop + mobile) | 52 | 0 | — |
| Assistant HTTP, owner sign-in smokes | PASS, PASS | — | — |
| Props ledger audit + calibration audit (real ledger) | All PASS, `IDENTITY_OK` | — | — |
| Experiment manifest verify + drift drill | PASS | — | — |
| Scheduler coverage simulations | PASS (#157), 12 of 12 (#158) | — | — |

CI on the newest commits of each PR is listed on the PRs. At writing, #157 was green on `3b99aa3` and later runs were
in progress.

## 12. Code changes (Friday)

- **#157:**
  - `scripts/props-calibration-audit{,-lib,.test}.mjs` + preflight step;
  - manifest records scheduling files, with a refreshed candidate;
  - this report.
- **#158** (draft): `vercel.json`, `src/lib/server/scheduler-kickoff.ts`, `src/lib/server/scheduler-kickoff.test.mjs`.
- **#159:** `src/lib/server/bearer.ts`, `src/lib/server/bearer.test.mjs`, `src/app/api/internal/data-health/route.ts`,
  `.github/workflows/verify.yml`.

No active model, rule, stake, risk setting, budget, live schedule or broker path was changed. Nothing was merged or
deployed, and no production SQL was run.

## 13. PR links

- [#157](https://github.com/ang87505-crypto/SportsEdge/pull/157): readiness, audits and tooling (READY_FOR_OWNER_MERGE)
- [#158](https://github.com/ang87505-crypto/SportsEdge/pull/158): hourly tick backups (draft; approval)
- [#159](https://github.com/ang87505-crypto/SportsEdge/pull/159): data-health constant-time check
- [#102](https://github.com/ang87505-crypto/SportsEdge/pull/102): stock PAPER orders (protected; Monday gate)

## 14. Unresolved blockers

| Item | Status |
|---|---|
| Lab SQL | BLOCKED — OWNER ACTION |
| Production RLS check | BLOCKED — OWNER ACTION |
| Hourly backups | BLOCKED — OWNER ACTION (#158) |
| Real fills, Stop/Start, close mark | BLOCKED — EXTERNAL DEPENDENCY: Monday's market session |
| `CLOCK_SKEW` test | INCOMPLETE (low risk; cannot add to the pinned head) |
| Pick6 payouts | BLOCKED — EXTERNAL DEPENDENCY (not published) |

## 15. Owner approvals required

1. Merge #157 (and #159).
2. Decide on #158: before Sunday's freeze, or after Monday.
3. Optional: apply `props_lab_v1.sql`.
4. Run the RLS SQL in §8.
5. Keep one Monday execute check-in (recommend `trig_018nhvJDxGeNoky49ZBthdTV`, 14:38 UTC; disable 14:35).
6. Confirm the release watcher may merge #102 once the gate passes.
7. Confirm the Sunday 18:00 UTC freeze.

## 16. Saturday's remaining tasks (can begin immediately)

- **48-hour capture review** (06:10 UTC check-in): preflight, ledger and calibration audits. Nov 12 entries
  #16–#18 should be settled and `IDENTITY_OK`.
- **Backup delays:** record today's tick backup start delays against §9.
- **Stock lab:** confirm the stock lab freeze for the week of Nov 16 is appended on `research-data`.
- **Stock suites:** rerun them only if anything in the stock path changes (expected: nothing).

## 17. Sunday freeze checklist (18:00 UTC, on your confirmation)

1. Merge only what you've approved (not #102).
2. `node --experimental-strip-types scripts/experiment-manifest.mjs verify docs/experiments/manifest-2026-11-13-candidate.json`
   → `FROZEN_MATCH`. Then `snapshot docs/experiments/manifest-2026-11-15-freeze.json` and commit it.
3. Ops monitor 14 of 14; production matches `main`; preflight all PASS; #102 head `9e23e63`.
4. Gate reason `STOCK_SUPERVISED_EXECUTE_REQUIRED`.
5. One Monday check-in enabled.
6. No merges until Monday's after-close mark.

## 18. Monday go/no-go

- **GO:** every item in §17 still holds Monday 7:00 AM MT; the decision is TARGETS; you're available until the close.
- **NO-GO / postpone:** any condition in §7's cancel list.
- **During the session:**
  - one release-branch execute;
  - inspect real fills on the Autopilot "Risk and execution" panel;
  - after the fills, before the 2:00 PM MT close: Stop, then Start;
  - after the close: mark recorded, then dispatch the ops monitor;
  - no model or configuration changes all day.
