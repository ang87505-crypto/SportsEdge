# Unattended operations (2026-11-10)

Everything below runs on **GitHub Actions**, **Vercel** and **Supabase** with the repository's existing
credentials. Routine work needs no Claude or ChatGPT account, conversation, reminder, paid model API or
personal computer. Live status: **https://sports-edge-eta.vercel.app/automation** → *Background jobs*, and
*Ask SportsEdge* → "Is everything running?".

Real money stays off (`realMoneyEnabled: false` in both releases). Stock broker writes stay off on `main`
(`brokerWritesEnabled: false`) until PR #102 is released after a genuine supervised session (below).
No research candidate is active. Risk limits (`config/paper-auto/stock-v2-weekly-1.json`, the props budget
policy) and owner controls are unchanged.

## What runs, when (Mountain time shown for standard time, MST = UTC−7; add one hour during daylight time)

| Job | Trigger(s) | UTC | Mountain (MST) | Protection against duplicates |
|---|---|---|---|---|
| Props settle (grading) | GitHub schedule; **Vercel backup** | 09:20, 15:20 daily; backup 10:00–10:59, 16:00–16:59 | 2:20 AM, 8:20 AM; backup 3 AM, 9 AM hour | DB slot key `settle-YYYY-MM-DDTHH` + lease; a second start is `DUPLICATE` |
| Props collect (lines, picks, entries) | GitHub schedule; **Vercel backup** | 19:10, 22:10 daily; backup 20:00–20:59, 23:00–23:59 | 12:10 PM, 3:10 PM; backup 1 PM, 4 PM hour | Same slot key; daily credit budget (`props-budget-v2`, 7/day) |
| Props research snapshot | GitHub schedule | 15:45, 19:25, 22:25 | 8:45 AM, 12:25 PM, 3:25 PM | Read-only receipts |
| Props learning (train, shadow evaluation, review) | GitHub schedule | Sun 10:00 | Sun 3:00 AM | Owner actions refused from schedules; registered promotion gate |
| Stock weekly decision | **Vercel cron kickoff** (primary in practice); GitHub schedule | kickoff 09:00–09:59 weekdays; schedule 11:20 weekdays | 2 AM hour; 4:20 AM | One decision per session; late decisions are skipped, never back-filled |
| Stock execute/monitor slots | GitHub schedule | 13:50, 14:50, 15:20–18:20 hourly, 20:35, 21:35 weekdays | 6:50 AM … 2:35 PM | Leases, idempotent intents, Alpaca clock/calendar checks; orders need owner Start **and** released writes (#102) |
| Research collection + forward ledgers + report + `summary.json` | GitHub schedule; **Vercel backup** | 02:17 Tue–Sat; backup 04:00–04:59 Tue–Sat (skipped if a run succeeded in the last 20 h) | 7:17 PM Mon–Fri; backup 9 PM hour | Append-only snapshots with hashes; derived `summary.json`/`LATEST.md` |
| Research monthly evaluation | GitHub schedule | 04:23 on the 3rd | 9:23 PM on the 2nd | Pre-registered rules; append-only results |
| **Operations monitor** | GitHub schedule; after every job above finishes; **Vercel backup** | 01:07, 05:07, 09:07, 13:07, 17:07, 21:07; backup 13:00–13:59 | 6:07 PM, 10:07 PM, 2:07 AM, 6:07 AM, 10:07 AM, 2:07 PM | Read-only; writes `ops-status/status.json`; one alert issue |
| Temporary PAPER release watcher | GitHub schedule (hourly) | until 2026-11-11 07:00 | until midnight Nov 10 | Retires itself; see below |

DST: the stock jobs list both possible UTC hours, and the controller acts only inside the real New York
session from Alpaca's clock and calendar (holidays and early closes included). Props slots are fixed in UTC;
their Mountain times move by one hour with daylight time. The monitor and site display America/Denver time.

## Audit findings

- **GitHub schedules are unreliable here.** From real run history (7 days to 2026-11-10 01:45 UTC):
  scheduled runs started 40 minutes to 10 hours late, and many planned times never ran. The 11:20 UTC
  stock decision on Mon Nov 9 started at 21:26 UTC, after the close; the Vercel kickoff dispatch at 09:16
  UTC is what decided that session. The props 09:20 UTC settle slot rarely fired on schedule. This is a
  GitHub platform behaviour (scheduled runs may be delayed or dropped under load), not a credential problem.
- **Fix:** daily Vercel crons now back up the time-sensitive props and research slots and the monitor
  (`/api/internal/scheduler/<slot>`). They use the existing `CRON_SECRET` and `SPORTSEDGE_GITHUB_DISPATCH_TOKEN`.
  A props backup run carries its scheduled slot (`props-daily.yml` input `cron`), so the ledger refuses whichever
  start comes second. Vercel Hobby allows 100 daily crons per project with per-hour precision; every new cron is
  once a day and each slot only acts inside its own UTC hour.
- **Dispatch permissions:** the Vercel token already dispatches `paper-auto-decision-weekly.yml` (weekday
  09:0x UTC runs) and dispatched `props-daily.yml` on 2026-11-08. The monitor's `stock-kickoff` row proves the
  token works each weekday; if it stops (expired token), the row goes to *Missed a planned time* and the alert
  names the Vercel setting.
- **Inactivity:** GitHub disables schedules in a repository with no activity for 60 days. The monitor shows a
  disabled workflow as *Disabled* and opens the alert.
- **Credentials:** the monitor checks presence of every GitHub secret (never values) and the expiry date
  embedded in each Supabase service key. Vercel environment values cannot be read from GitHub; they are verified
  by their effects (kickoff dispatches, live site and chat checks).

## Monitoring and alerts

`ops-monitor.yml` reads run history and real receipts (props ledger runs, research `summary.json`), evaluates
each job (Running, Missed a planned time, Stale, Failing, Disabled, First run pending), probes the live site
(pages, chat answers including a follow-up, and that stock account data and owner/cron routes refuse anonymous
calls), and publishes `status.json` on the `ops-status` branch with monthly history. A planned time is always
labelled *planned*; only GitHub run records count as executions. When something breaks it opens one issue
labelled `ops-alert` (GitHub emails the owner), comments when the problem list changes and closes it when
healthy. Owner-pending steps that are not failures (the supervised stock session, an owner pause) stay on the
dashboard only.

## Temporary release watcher

`paper-release.yml` was a one-time watcher pinned to PR #99 (props, already merged) and PR #102 (stock PAPER
orders). Its window ends **2026-11-11 07:00 UTC**; on its next run after that it records
`EXPIRED_REVIEW_REQUIRED` and disables itself. By design nothing merges #102 automatically afterwards. The
operations monitor keeps evaluating the **same** `stockReleaseGate` against the same pinned head, check-only, and
shows whether it passed.

## First supervised stock paper session (needs the owner)

**If chat says the account is ready or armed while paper orders are disabled:** your Start action has
already been recorded. The account check and the permission to send orders are separate. This is
**planning only**; a successful execute worker may have made a shadow plan or skipped outside market
hours. Check its result and actual order/fill records. Pressing Start again does not enable the release.

The stock gate requires all of the following on one real session, in order. The weekly picks are made on the
first market day of the week, so the earliest qualifying session is **Monday 2026-11-16**:

1. Early that morning: open https://sports-edge-eta.vercel.app/stocks/paper-auto, sign in with the owner key,
   confirm the weekly decision shows targets and the fresh account check is clean. If owner permission is
   already **ARMED**, Start is recorded. Otherwise press **Start** when you are ready for the paper test.
2. After the market opens (7:30 AM MT): GitHub → Actions → *Recurring PAPER worker (manual)* →
   **Run workflow** → branch **`release/stock-paper-orders`** → kind **execute**, experiment
   `stock-v2-weekly-1`. Check the Autopilot page for real paper intents and fills.
3. Press **Stop** on the Autopilot page; run the same workflow on `main` with kind **reconcile** and confirm it
   reports a clean account; then press **Start** again.
4. After the close (2:35 PM MT monitor slot, or run kind **monitor** on `main`), confirm the day's mark is recorded.
5. The *Background jobs* panel then shows the release gate as passed. Review PR #102 and merge it yourself.

A shadow plan, a HOLD day, a green workflow or this document is not evidence for any step.

## Verification receipts (2026-11-10)

| What | Evidence |
|---|---|
| Chatbot released | PR #112 merged after all checks passed (browser smoke fixed: hydration wait and Chrome start retry); production deployment of `8040aa6` succeeded |
| Operations monitor and backup scheduler released | PR #113 and #115 merged after all checks passed; production deployments succeeded (Vercel accepted the six new daily crons) |
| Event-driven monitor run | [42740187373](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42740187373), started automatically when another workflow finished |
| Alert opens and closes by itself | [Issue #114](https://github.com/ang87505-crypto/SportsEdge/issues/114) opened at 02:04:45 UTC during a deployment roll-out, closed at 02:05:20 UTC when healthy |
| Live site, chat and owner protections | [42740799665](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42740799665): 13 of 13 checks passed from GitHub, with no browser or AI session involved |
| Props receipts | Last completed collect 2026-11-10 02:00 UTC, last completed settle 2026-11-09 23:48 UTC, control RUNNING |
| Stock release gate (check-only) | `STOCK_SUPERVISED_EXECUTE_REQUIRED` on pinned head `25bbb65c57e2` |
| Secrets | All nine GitHub secrets present; both Supabase service keys are the non-expiring `sb_secret_` type |

Scheduled (unattended) receipts appear on the *Background jobs* panel as they happen; a job whose first
scheduled run has not happened yet is shown as *First run pending*, never as a success.

## Old reminders

Once the *Background jobs* panel shows a real run for the matching row, a chat reminder that only asked
"did X run / check X" is redundant and can be retired:

| Reminder about | Replaced by |
|---|---|
| Checking that PrizePicks collected or settled | Props rows + props receipts on the panel; Vercel backup slots; alert issue |
| Checking the stock decision / early kickoff | *Stock paper: weekly decision* and *early decision kickoff* rows |
| Checking research collection, forward ledgers or reports | Research rows, `research-data/summary.json`, alert issue |
| Checking the monthly research evaluation (3rd of the month) | *Strategy research: monthly evaluation* row (first scheduled run 2026-12-03 04:23 UTC) |
| Checking the site or chat is up | Live site checks every monitor run |
| Watching the PAPER release watcher / PR #99 | PR #99 is merged; the watcher retires itself after 2026-11-11 07:00 UTC |

Keep one reminder, or a calendar entry, for the **first supervised stock paper session (Monday 2026-11-16)**
until PR #102 is merged. It needs you, and nothing automatic can stand in for it.
