# SportsEdge without ChatGPT or Claude subscriptions

The recurring workers and this release watcher run in GitHub Actions. The early
weekly data kickoff runs on Vercel. Supabase stores their records. Neither AI
subscription, a model API, an open browser nor the owner's computer runs the jobs.

The GitHub workflow **Independent PAPER release checks** replaces the AI task as
the authority for completing the two already requested, conditional releases.
It checks hourly at :43 UTC, subject to GitHub delivery delays. A push that changes
the watcher runs a read-only configuration check. The owner can also run it with
`mode: check` without changing a release.

## Release conditions

| System | Conditions before merge |
| --- | --- |
| NBA props, PR #99 | At or after Nov 8, 2026, 9:00 AM MST; budget v2 active; control RUNNING; the actual Nov 7 collection's pre-lock, non-fixture observations and model predictions on both platforms; later final box-score grades; every created entry settled with the captured simulated PrizePicks terms and unknown Pick6 returns. No entry quota. |
| Stocks, PR #102 | Owner Start; successful manual execution on the exact reviewed release branch; actual fills for that session's TARGETS decision; owner Stop and a fresh clean reconcile/Start; clean same-session after-close result; no active/uncertain intents, unresolved critical alerts or unexplained activity. |

Both also require the exact pinned PR head and changed-file blob hashes, all
present checks successful, the named required checks present, no outstanding
changes-requested review and a mergeable PR targeting main. The script never runs
code from either PR. Changes to a head or its diff require a fresh review and a
reviewed update to the pin manifest. It sends the expected head SHA with the
squash-merge request. A lost merge response is not retried.

Immediately before merging, the script rechecks the code/CI and the ledger.
Every normal worker still obeys the owner's live Pause/Stop controls. This
watcher never starts, resumes, executes, cancels, collects or settles anything.
It holds no broker, Odds API, OpenAI or Anthropic credential. Its database calls
are read-only, using the existing project-pinned adapters and GitHub secrets.
There is no schema migration, new subscription, account connection or budget change.

## The owner's first stock session still needs the owner

Earliest planned session: Monday, Nov 9, 2026, only if that morning's timely
decision is valid. The watcher cannot create the first-session acceptance itself.

1. Open [stock Autopilot](https://sports-edge-eta.vercel.app/stocks/paper-auto),
   sign in, inspect the paper account and deliberately press **Start**.
2. On [Recurring PAPER worker](https://github.com/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-worker.yml),
   choose branch `release/stock-paper-orders`, kind `execute`, experiment
   `stock-v2-weekly-1`, during regular hours after the valid decision. The inspected
   branch head is `25bbb65c57e295a4b902deaa035b7d3e1bc5eec6`. Do not execute an
   unreviewed replacement head or count a shadow/HOLD/blocked run as acceptance.
3. Check the actual Alpaca PAPER orders/fills and the ledger. Test **Stop
   autopilot**, then deliberately use **Start** again after checking the account.
   The latter performs the required fresh reconciliation. The watcher requires
   an actual Stop after the successful execute and an owner restart after it.
4. Wait for the same session's clean after-close monitor record. If all release
   checks pass, GitHub completes the recurring release automatically.

No AI account is needed for those GitHub and owner-page actions. A Stop or Pause
continues to block automation until the owner acts. This document is not a command
for an agent to submit the first order or operate these owner controls.

## Runtime and follow-through

After release, props uses its existing collection and settlement slots. Stocks
uses the existing weekly decision, execution and after-close monitor schedules.
The first genuinely scheduled receipts and the production deployment still need
verification; merging is not proof that a later job ran or produced a qualifying
pick. Use the [automation dashboard](https://sports-edge-eta.vercel.app/automation)
and [Actions history](https://github.com/ang87505-crypto/SportsEdge/actions).

The release watcher retires itself once both PRs are merged, or at the end of
Tuesday Nov 10 MST (Nov 11 07:00 UTC). If acceptance is still missing at expiry,
it fails that final check, records the blocker and disables only itself. The
daily/weekly workers continue independently. A later release needs owner review;
it never silently removes a condition to meet a date.

GitHub/Vercel availability, configured credentials, the data allowance and the
database remain dependencies. GitHub schedules can be delayed or dropped; late
decisions stay skipped. Hosting/database access and provider allowances are
separate from ChatGPT and Claude subscriptions. No always-on guarantee is implied.

## Verification

`node --experimental-strip-types --test scripts/paper-release.test.mjs` exercises
the positive release paths and refusal cases for missing/false receipts, paused
controls, wrong budgets, incomplete CI, changed heads/files, missing fills,
Stop/restart, contaminated results, an owner Stop racing the release check,
untrusted execution contexts and unknown merge outcomes. All fixtures are synthetic.

Live deployment validation must include the workflow's first read-only run and
its step summary. A green unit suite is not proof of a real collection, fill or
production release.
