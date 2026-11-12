# SportsEdge production completion sprint (2026-11-11)

PAPER only throughout:

* no broker order was submitted;
* no release switch, schedule, budget row, registered decision rule or production data was changed;
* nothing was merged or deployed, and nothing was purchased.

Evidence comes from:

* GitHub Actions run receipts;
* the ops monitor's published `ops-status/status.json`;
* read-only probes of the production site and of the Supabase REST endpoints (no keys sent);
* local tests against isolated PostgreSQL databases and a fake broker.

No database, Vercel or Alpaca credentials were available in this session.

## 1. COMPLETED (implemented and independently verified)

| Item | Evidence |
|---|---|
| **Database map confirmed** | Props jobs → `vfyzbliksooljxrlfadp` (pinned by `scripts/paper-release.mjs`). Stock PAPER jobs → the same project (`paper-auto-store.ts` pin). Website research/sports pages → `fzyjazhvkstvwwzjhlrr`. Both answered an unauthenticated probe with 401 "No API key", i.e. running. Latest stock worker receipt (00:50 UTC) read its ledger (`SLOT_ALREADY_FINISHED`); props receipts show the market v1, learning v1 and budget v2 schema in use. |
| **Inactive staging project identified** | `mcaxfaaohyencpspalfe` (the October Alpaca staging project) **no longer resolves in DNS**: paused or deleted. Only the October owner-only one-order/staging panels on `/stocks/alpaca` and synthetic Preview fixtures use it. Those panels fail safe: 503 `staging_control_unavailable`, `orderSubmissionEnabled:false`, "No Alpaca order was sent". Current stock automation does not depend on it. |
| **Unnecessary Vercel deployments stopped (PR #137)** | `ops-status` (36 pushes on Nov 10) and `research-data` publishers now commit `vercel.json` with deployments off. `main`'s `vercel.json` excludes `ops-status`, `research-data`, `research/**`, `docs/**` and `audit/**`. Real publisher scripts are tested against a local bare repo (14/14), with a mutation check. |
| **Dashboard metric corrected** | "Up to 12 virtual entries a day" summed inactive v2 accounts; the cap is 6 with the stats model active. Fixed and tested (#137, also in #135). |
| **PR #135 + #136 jointly reviewed and fixed** | #136 folded into #135. Fixed:<br>• shared budget accounting for worker and dashboard;<br>• the worker spends under the **stricter** of the database row and the reviewed policy;<br>• the tick workflow's own concurrency group (pending settles can no longer be cancelled);<br>• per-kind ledger reads in the dashboard and ops monitor (harness: `main`'s monitor loses settles under a tick-heavy ledger);<br>• one next-collection helper for all pages and the assistant. |
| **Props validation** | 255/255 props, assistant and server unit tests. 6/6 SQL suites and 9/9 real-schema end-to-end tests, including a Nov 9→10 carryover replay (v2 refuses; v3 prices exactly one game; the database cap agrees). Mutation checks: release switch, anchor, started-game filter, provider-charge accounting. Real-tip-off replay: 12 games, 6/6 entry-capable slates for 36 credits. Activation checklist SQL executed against the real schema. CI on #135: 10/10 green. |
| **Stock PR #102 audited on a would-be merge with `main`** | Broker adapter, store, clock: 22/22. Owner/performance: 35/35. Python bridge: OK. Kickoff: 4/4. Controller end-to-end against the real schema and a fake broker: 32/32 (0 skipped), covering:<br>• the owner STOP kill switch, including a lost stop call;<br>• unknown POSTs never retried, and duplicate client ids resolved by lookup;<br>• external orders, positions or a different account stopping the experiment;<br>• drawdown and capital-ceiling stops, stale quotes and late slots, DST;<br>• Stop beating a queued Start, and duplicate deliveries sharing one lease.<br>Release gates: 13/13. |
| **Stock PR #130 tested and strengthened** | 5/5 commissioning tests and 415/415 analytics tests on the merge with `main`. Added an end-to-end test (pushed to #130): the database accepts and the controller trades a midweek flat-account commissioning decision; a held position is refused; nothing trades before the owner arms. CI on #130: 7/7 green. |
| **Production QA (read-only, real browser)** | Every major route at 390 px and 1440 px: all 200 (an unknown route returns a proper 404 page). Also verified:<br>• no horizontal overflow, no `NaN`/`undefined`/`Invalid Date`, no stuck loading state;<br>• 25/25 internal links resolve;<br>• every owner and cron endpoint refuses anonymous calls (401; the research GET returns 405);<br>• the props dashboard matches stored receipts: last collection Nov 9 7:00 PM MST; 166 PrizePicks and 54 Pick6 lines; 9 settled entries; −$15 (1–5), −50% ROI on $30 staked; both Nov 10 slots `BUDGET_EXHAUSTED` via the Vercel backup at +61 and +62 min. |
| **Anonymous 401 on every page fixed (#137)** | The app-shell Autopilot badge called an owner-only API for every visitor. Sign-in now sets a non-secret hint cookie; visitors without it make no owner call. Verified:<br>• the sign-in HTTP smoke on a production build (the hint alone is refused 401; logout clears both cookies);<br>• 0 anonymous 401s on six pages;<br>• browser smoke 48/48.<br>`/stocks` and `/stocks/alpaca` keep one view call to tell "not configured" from "sign in". |
| **Full JS inventory** | 573 tests in 88 files: 542 pass, 0 fail; 31 skipped by design (database end-to-end suites, run separately above). |

## 2. READY FOR APPROVAL (tested; needs the owner)

| Item | What approval does | Where |
|---|---|---|
| PR #137 (deployments, entry cap, anonymous 401s) | Merge; deployment exclusions take effect on the next data-branch push | #137 (also contained in #135) |
| PR #135 (event-aware props capture), released off | Merge is inert. Then follow the checklist: apply `props_capture_v1.sql` → optional v3 accounting → optional manual tick → `tickEnabled:true` | `docs/PROPS_CAPTURE_ACTIVATION_CHECKLIST_2026_11_11.md` |
| Props v3 accounting (same limits) | Provider-confirmed charges count; the free events list and empty attempts stop consuming the cap | Checklist step 2 |
| PR #130 commissioning session | Changes the registered weekly rule for one flat-account session (Wed 2026-11-11). To use **today** it must be merged before the 09:00 UTC (2 AM MT) Vercel decision kickoff; otherwise the next regular session is Mon Nov 16. | #130 |
| PR #102 PAPER order release | Only after a genuine supervised session passes the pinned gate (head `9e23e63`, not modified) | `docs/AUTOMATION_OPERATIONS_2026_11_10.md` |
| Legacy staging project | Either restore `mcaxfaaohyencpspalfe` or approve retiring the October one-order panels and Preview fixtures that use it | §4 |

## 3. AWAITING LIVE EVIDENCE

| Item | Needs |
|---|---|
| First supervised Alpaca PAPER session | A market session with the owner: decision `TARGETS`, owner Start, manual execute on `release/stock-paper-orders`, Stop/Start reconcile, after-close mark |
| Props capture ticks in production | Activation, then real tick receipts (plans, captures, `x-requests-last` of empty attempts, availability before 6 h) |
| Timing study verdict | ≥ 20 slates and 150 graded picks per window (about 3–4 weeks after activation) |
| Today's props collects (Nov 11) | The 19:10 slot should spend again: the Nov 9 credits rolled off at 02:00 UTC |
| PR #137 effect | Next `ops-status` push after merge carries `vercel.json`; Vercel should show no deployment for it |

## 4. BLOCKED (cause and required action)

| Item | Cause | Action |
|---|---|---|
| Direct database verification (schemas, migration list, row counts) | No Supabase credentials in this session | Owner runs the checklist's verification SQL, or provides read-only access |
| Vercel deployment list and environment checks | No Vercel access; the GitHub deployments page needs sign-in | Owner confirms in the Vercel dashboard after #137 merges |
| `mcaxfaaohyencpspalfe` status (paused vs deleted) | DNS no longer resolves; the Supabase dashboard is required | Owner decides: restore from the Supabase dashboard, or retire the dependent panels (a small code change on request) |
| Supervised stock session | Needs the owner during market hours by design | See §2 and §3 |
| Owner-only pages (`/stocks/paper-auto` controls, `/stocks/alpaca` panels) in production | Owner sign-in secret not available | Verified by local tests; owner spot-check |
