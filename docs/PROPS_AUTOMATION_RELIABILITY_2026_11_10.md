# Props automation reliability (2026-11-10)

## What happened on November 9

Traced from GitHub run records and each worker's recorded receipt (`props_runs` summary). Times are UTC
(Mountain = UTC−7).

| Slot (scheduled) | GitHub run | Trigger | Run created and started | Delay recorded | Outcome |
|---|---|---|---|---|---|
| settle 09:20 | 42687728687 | GitHub schedule | 19:53 | 634 min | COMPLETED: 78 lines graded, 3 entries settled |
| settle 15:20 | 42723331707 | GitHub schedule | 23:47 | 508 min | COMPLETED: nothing new |
| **collect 19:10** | 42739655657 | GitHub schedule | 02:00 (Nov 10) | **410 min** | COMPLETED, see below |
| collect 22:10 | 42753467042 | GitHub schedule | 04:04 (Nov 10) | 354 min | BUDGET_EXHAUSTED before any spend |

**The 19:10 collect.**
- **Games:** 6 games had already started. Of the 11 still to start, 1 was chosen, 1 was too close to tip-off, and 9
  were the next day's games beyond the 10-hour horizon.
- **Recorded:** 36 lines, 70 model estimates and 36 decisions. Only 10 decisions were recorded as qualifying picks;
  the rest were skips.
- **Credits:** it spent 4 (an events list plus one game).
- **Entries:** none. With every line from one game, no two-pick entry could meet the different-games rule.

**The 22:10 collect.** Budget v2 allows 7 credits per rolling 24 hours, and starting a collect needs 4. After the
19:10 run spent 4, the 3 left were not enough.

**What did not contribute.**
- **Manual runs:** every run listed above was a GitHub `schedule` event. No manual replay happened that day.
- **Slot keys:** each run carried the cron that fired it (`SCHEDULE_CRON`), and each slot key matches its own slot.
  Past midnight UTC the key stays on the previous day: `collect-2026-11-09T19` at 02:00.

**Root cause.** GitHub started every slot 6–10.6 hours late. The Vercel backup triggers in
`/api/internal/scheduler/<slot>` were deployed afterwards (2026-11-10 02:04 UTC), so there was no second trigger yet.

**Knock-on effect.** The daily cap is rolling, so the 4 credits spent at 02:00 UTC on November 10 count until
02:00 UTC on November 11. The on-time collects for the November 10 slate (19:10 and 22:10 UTC, and their backups)
therefore have 3 credits and will record BUDGET_EXHAUSTED. This follows from the owner-approved policy; it is not
changed here.

## Changes

- **Late collects spend nothing.**
  - **Rule:** a scheduled collect that starts more than **150 minutes** after its slot records `SKIPPED_LATE` before
    reading the budget or calling the provider.
  - **Why:** a late collect mostly finds started games, and through the rolling cap it takes credits from the next
    on-time collect.
  - **Coverage:** the Vercel backups fire 50–109 minutes after each collect slot, inside the window (tested).
  - **Unchanged:** manual collects (no slot) and settles (free; ESPN only).
- **Backup slot runs.** A backup run carries its scheduled slot, so the ledger's `(kind, slot_key)` uniqueness
  refuses whichever start comes second (`DUPLICATE`, or `BUSY` while one is running). This applies to retries after a
  failure too, so paid calls are never repeated; a failed slot waits for the next slot.
- **Trigger recording.** Every run records what started it: `github-schedule`, `backup-dispatch` or `manual`.
- **No-entry reasons.** When an account makes no entry, collect records why:
  - `NO_QUALIFYING_PICKS`;
  - `PICKS_TOO_CLOSE_TO_LOCK`;
  - `TOO_FEW_DISTINCT_GAMES`;
  - `TOO_FEW_DISTINCT_PLAYERS`;
  - `DAILY_ENTRY_LIMIT_REACHED`;
  - `NO_VALID_COMBINATION`.

  No rule is relaxed and no entry is forced.
- **Automation page, PrizePicks → "Recent and next slots".** Each slot shows these separately:
  - the scheduled time;
  - state (planned, no run recorded, running, completed, skipped, failed);
  - trigger and delay;
  - finish time;
  - decisions (skips included) and qualifying picks, as separate columns read from the saved pick rows. Unknown when
    they cannot be read. A historical receipt's `picks` field counts decisions, not qualifying picks;
  - entries made, with the reason when none;
  - entries settled.

  A planned slot is never shown as a run.

**Unchanged:** model rules, the selection rules, pregame locks, distinct-game and distinct-player rules, stakes,
entry limits, the budget policy, append-only records, stock execution settings and the frozen November 10 experiment.

## Tests

- **`src/lib/props/reliability.test.mjs`:**
  - no-entry reasons, including the Nov 9 single-game case;
  - slot keys for late and after-midnight arrivals;
  - New York midnight across both DST changes;
  - every backup window inside the late limit;
  - slot status keeping its stages separate.
- **`src/lib/server/props-cycle.integration.test.mjs`** (real schema on PostgreSQL), checking at each step the
  provider-call count, reserved credits and entries:
  - primary and backup racing on one slot: one completes, 3 provider calls and 7 credits once;
  - a late duplicate: no calls;
  - a 155-minute-late arrival: `SKIPPED_LATE`, no calls or credits;
  - a 149-minute arrival just after midnight: completes under its own key;
  - a partial provider failure with a refused backup: no repeated calls, no single-game entries;
  - a mid-run network drop with a refused backup: one row, no new entries.
- **Mutation check:** with the late limit disabled, the reliability test fails (`COMPLETED` instead of
  `SKIPPED_LATE`).
