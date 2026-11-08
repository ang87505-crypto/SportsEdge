# Owner runbook: running SportsEdge without Claude or ChatGPT

Everything that runs day to day lives on **GitHub Actions** (the jobs), **Supabase**
(the records) and **Vercel** (the website). No AI subscription or model API is
used by any job. You only need a browser and your owner key.

Site: https://sports-edge-eta.vercel.app

## Daily: nothing to click

The PrizePicks paper test runs itself every day (New Mexico times shift by an hour
with daylight saving):

| What | UTC | New Mexico (winter) |
| --- | --- | --- |
| Grade last night's games | 09:20 | 2:20 AM |
| Grade again (late finals, stat corrections) | 15:20 | 8:20 AM |
| Collect lines, record picks and entries | 19:10 | 12:10 PM |
| Second collection (only spends if the first could not) | 22:10 | 3:10 PM |

Each collection prices at most 2 games (data budget `props-budget-v2`), records only
picks with 60–80% model confidence, and makes at most three $5 virtual 2-pick
entries per platform per day.

## Common tasks

| I want to… | Where | What to do |
| --- | --- | --- |
| See today's picks and how it is doing | **PrizePicks** page (`/paper-betting/props`) | Status, balance, record, hit rate and upcoming picks are at the top. |
| Pause / Resume / Stop PrizePicks | PrizePicks page → **Controls** | Sign in with the owner key and press the button. Results are kept. |
| Collect lines or grade results now | GitHub → Actions → **NBA props paper cycle** | **Run workflow** → kind `collect` or `settle` → **Run workflow**. Refresh the site after 1–2 minutes. |
| Read-only status check | Same workflow | kind `status`. |
| Load missed box scores | Same workflow | kind `backfill`, `from`/`to` as `YYYY-MM-DD` (at most 25 days). |
| See if something failed | **Automation** page (`/automation`) | A yellow badge means look. Open PrizePicks → *Run history* for receipts. |
| Start / Stop the stock autopilot | **Stocks → Autopilot** (`/stocks/paper-auto`) | Sign in, check the paper account, press **Start** or **Stop autopilot**. |

Pause, resume and stop also work from the GitHub workflow (kinds `pause`,
`resume`, `stop`, with a short `reason`). Both routes change the same control.

## Owner key

Owner sign-in uses `SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY`, a 64-character hex key
saved in Vercel → Project → Settings → Environment Variables. A sign-in lasts 30
minutes. Never paste the key anywhere except the site's sign-in box.

## When something looks wrong

| You see | Meaning | Do this |
| --- | --- | --- |
| **Paused** or **Stopped** | Someone (you) stopped it; nothing new runs. | Read the reason on the Controls panel, then press Resume. |
| **Needs attention** | The latest run failed. | PrizePicks → Run history: check the outcome. Then run `status` on GitHub. A one-off provider or network error usually clears on the next slot. |
| **Data budget paused** | The Odds API allowance is nearly used up. | Wait for the monthly allowance to reset. Grading still works. |
| **Collection overdue** | No scheduled collection in 36 hours. | Check GitHub Actions is enabled and the secrets below are set, then run `collect` by hand. |
| "No upcoming picks" | No line met the 60–80% rule, or no games today. | Normal. Nothing is forced. |
| Page says "not connected" | Vercel is missing the props database settings. | Check the Vercel variables below. |

## Settings the jobs depend on

GitHub → Settings → Secrets and variables → Actions:

- `SPORTSEDGE_PROPS_SUPABASE_URL`, `SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY`: the props database
- `ODDS_API_KEY`: The Odds API (needed for `collect` only)

Vercel uses the same two Supabase settings to show the dashboard, plus the owner key.

Outside dependencies that cost or limit nothing AI-related, but can still stop jobs:
GitHub Actions minutes and schedule delays, The Odds API monthly credits, Supabase
free-tier pausing after inactivity, and Vercel hosting.

## What the numbers mean

- **Virtual balance:** $500 starting bankroll plus every settled PrizePicks entry. Open entries do not move it.
- **Entries won–lost:** settled two-pick Power Play entries. Both right pays 3x; one right plus a tie or did-not-play pays 1.5x; two voids refund.
- **Pick hit rate:** graded More/Less picks that were right. Break-even for a two-pick Power Play is about **57.7%**. A small sample is noisy.
- **Pick6:** tracked alongside, but its payouts depend on other entrants, so no dollar result is shown.

Nothing here places a real entry or moves money.
