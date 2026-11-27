# SportsEdge observation-mode handoff — November 27, 2026

This handoff is for observing the systems already released on production, preserving frozen research rules. It is not an authorization for orders, exchange data, Start/Resume, migration, new scientific schedules or model promotion. GitHub/Vercel jobs run without a chat or personal computer remaining open.

## What can keep running

| System | Released operation | Evidence and limits |
| --- | --- | --- |
| Sports props | Collection, event-aware ticks, settlement and safety-brake checks | The operations monitor checks actual completed collection/settlement receipts and the brake. A successful empty tick is not a new pick. |
| NBA/EPL moneylines | Owner-approved saved-data refresh at 11:00 UTC daily | First planned slot: **Sat Nov 28, 4:00 AM MST**. PENDING_FIRST_RUN is intentional until an actual receipt exists. Slot/run/both sports must agree; no retries or automatic betting. |
| Stock research | Source collection and frozen forward research ledgers | SEC Q2/Q3 raw archives repaired in #237; source-only repairs cannot count as full nightly ledger runs (#238). Results do not promote a strategy. |
| Stock execution | Main remains shadow-only; account/order access stays owner-controlled | #102 stays unmerged until the genuine supervised-session gate passes. A successful shadow plan is not a fill. |
| Independent NOAA memory | Existing forecast/outcome collection and grading | New monitor verifies current-day and optional next-day before-lock forecasts, the required complete daily CLI product, its recalculated grade and matching scorecard. Six bounded public-archive GETs, no retries or provider/account calls. |
| Kalshi multi-source weather | Released paper forecast freezes and forward grading | Research only; exchange access and market-data permissions remain off. Historical NO_CLEAR_EFFECT and registered forward minimums remain. |
| Learning engine | Automatic evidence collection/evaluation for connected studies | Latest published run `46036112583-1` reports 854 clean graded lines and 185 selected picks; no model changed. Production coverage is 6 of 20 active experiments with automatic producers. Other experiments still need evidence integrations or owner-supplied results. |

## NOAA monitoring correction

Cron executions and scientific observations are different evidence. All original run links, missed-slot counts and timestamps remain. When daily archive bytes validate but a backup firing was missed, the job reports **RAN_LATE**, with `workflowStatus` retaining the original schedule judgment. It never calls that firing an execution or claims the collector ran on time. Workflow failures, disablement and stale/unknown execution remain visible even with good archives. Missing, corrupt, future or conflicting required daily evidence fails the archive check; green workflow history cannot override it.

The current climate day's forecast must already exist before its 05:00 UTC standard-time lock. The latest completed outcome becomes due after the existing 11:17 UTC backup plus the existing 180-minute operations grace (14:17 UTC). Before that deadline the preceding completed day remains required. This is a monitoring rule, not a change to capture, issuance, forecast matching or training. Tomorrow's archive may be absent before lock; an existing invalid tomorrow archive is still rejected.

Independent replay from research-data `8d4eec3a0522a9ab8db0256fa20ef641b74cad0f` verified:

- Nov 27 forecast captured Nov 26 `09:29:34.442Z`, 19.507 hours before its climate day.
- Nov 28 forecast captured Nov 27 `09:39:41.745Z`, 19.338 hours before its climate day.
- Nov 26 CLI captured Nov 27 `09:39:41.487Z`; grade recomputed and matched exactly; saved scorecard through Nov 26 has 9 days.

Moving this schedule earlier could change the frozen v1 horizon cohort. That remains a separately reviewed owner decision; this release makes no such change and does not backfill forecasts.

## Final checks that cannot be fabricated

1. **Nov 28, after 4:00 AM MST:** [Automation](https://sports-edge-eta.vercel.app/automation) must show the first actual moneyline collection receipt. Inspect failures rather than manually retrying or consuming extra provider credits.
2. **NBA #216 remains candidate-only.** Head `44b8782baab09f541d4ba1d5276d2d49143ef291` needs all 13 hosted readiness rows READY, including OVERALL, from props project `vfyzbliksooljxrlfadp`. The connected Supabase account exposes only the primary research project and inactive staging; neither substitutes for props readiness. Run the [pinned read-only query](https://github.com/ang87505-crypto/SportsEdge/blob/44b8782baab09f541d4ba1d5276d2d49143ef291/database/props/checks/forward_studies_readiness.sql) in the [props SQL editor](https://supabase.com/dashboard/project/vfyzbliksooljxrlfadp/sql/new). It changes nothing. Non-READY means stop and review; do not weaken grants or guards. Any hosted setup/migration is a separate owner action.
3. **#216 approval and final release:** record the specific additive `props-cycle.ts` shadow-hook approval, integrate latest main, rerun final-head CI and release outside the freeze. After an authorized merge, run main preflight and refresh the frozen experiment manifest within an hour; require genuine subsequent before-lock shadow/study receipts. No synthetic receipt counts as production evidence.
4. **Stock supervised paper session, Mon Nov 30:** follow [the complete timeline](STOCK_PAPER_SESSION_2026_11_30.md). Check TARGETS by 6:15 AM MST; owner arms 7:00–7:25; owner executes once 7:31–7:44 from the pinned paper-release branch. Only after fills, owner Stop/re-ARM with clean reconcile, and the after-close mark can the gate read STOCK_SUPERVISED_SESSION_VERIFIED. HOLD, missed input, an unknown order outcome or any failed gate means stop; never replay or automatically retry. No order is authorized by this handoff.
5. **Deployment freeze:** Sun Nov 29 **6:00 PM MST** through the Nov 30 supervised gate. Preserve the release branch pin and all stock frozen files. Optional features and cosmetic changes wait.

## How to observe

- [Overview](https://sports-edge-eta.vercel.app/), [Automation](https://sports-edge-eta.vercel.app/automation), [Learning Lab](https://sports-edge-eta.vercel.app/lab) and Ask SportsEdge share the published receipts. Public data caches can briefly lag a new receipt; compare displayed timestamps.
- The existing operations monitor runs every four hours and after watched jobs. Its existing GitHub alert issue reports operational failures; owner-pending releases remain listed separately. The monitor never places orders, resumes systems or promotes a model.
- A missing forecast is missing evidence. Keep it missing rather than recreating a historical prediction. Preserve failed/rejected experiments and all archived findings.
- Validation continues on its registered evidence clock: weather requires 50 graded forward days per horizon for review, stocks 26 forward weeks, NBA its registered line/date/game/decision minimums. Neither observation-mode readiness nor paper results establish profitability.

## Acceptance

Focused monitor/source/append-only contracts: 59 tests passed locally. Final release requires exact-head hosted CI, a READY main deployment, a fresh production operations snapshot containing verified `dailyEvidence`, and successful page/chat/owner-protection probes. Actual post-deployment receipts are recorded in the release PR; a green code check alone is insufficient.
