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
| Ask a question in plain words | **Ask** page (`/assistant`) | Type "how did last night go?", "tonight's picks", "why Booker?" or "is it running?". Free, read-only, never places bets. |
| Pause / Resume / Stop PrizePicks | PrizePicks page → **Controls** | Sign in with the owner key and press the button. Results are kept. |
| Collect lines or grade results now | GitHub → Actions → **NBA props paper cycle** | **Run workflow** → kind `collect` or `settle` → **Run workflow**. Refresh the site after 1–2 minutes. |
| Read-only status check | Same workflow | kind `status`. |
| Load missed box scores | Same workflow | kind `backfill`, `from`/`to` as `YYYY-MM-DD` (at most 25 days). |
| See if something failed | **Automation** page (`/automation`) | A yellow badge means look. Open PrizePicks → *Run history* for receipts. |
| Start / Stop the stock autopilot | **Stocks → Autopilot** (`/stocks/paper-auto`) | Sign in, check the paper account, press **Start** or **Stop autopilot**. |

Pause, resume and stop also work from the GitHub workflow (kinds `pause`,
`resume`, `stop`, with a short `reason`). Both routes change the same control.

## The learning model

Every line is scored by the stats model and, once set up, by a **learning model** that weighs the
stats model, the sportsbooks (DraftKings, FanDuel, BetMGM, Caesars, collected free in the same
request) and the matchup. It retrains every Sunday (GitHub → **NBA props learning loop**), scores
lines quietly as a challenger, and only becomes the active model after it passes the registered
test (500 graded lines, 14 game nights, 50 games, and better accuracy than luck explains).

| I want to… | Where | What to do |
| --- | --- | --- |
| See which model is active and how challengers are doing | PrizePicks page → **Model** | Active model, switches, weights in words, each challenger's state. |
| Stop or restart learning | PrizePicks → Controls → **Learning** | Off freezes the current model. |
| Choose automatic or manual switching | PrizePicks → Controls → **Auto-switch** | Off means a passing challenger waits for **Approve switch**. |
| Train a new challenger now | PrizePicks → Controls → **Retrain now** | Needs `SPORTSEDGE_GITHUB_DISPATCH_TOKEN` in Vercel; otherwise run kind `train` on the workflow. |
| Undo a switch | PrizePicks → Controls → **Roll back** | New picks use the previous model at once. |
| See what went wrong this week | PrizePicks → **This week's mistakes** | Misses grouped by cause. |

All of these also run from GitHub → **NBA props learning loop** → Run workflow (kinds `train`,
`evaluate`, `review`, `learning_on`, `learning_off`, `auto_on`, `auto_off`, `approve` with a version,
`rollback`). Owner kinds need a short reason and never run from the schedule.

**One-time setup (owner):** in Supabase → SQL editor, run `database/props/props_market_v1.sql`, then
`database/props/props_learning_v1.sql`. Until then the site and workers keep working on the stats
model alone and say "not set up yet".

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
| **Paused by the safety brake** | The active model's last picks hit confidently below 57.7%. | Read *This week's mistakes*; consider **Roll back**; press **Resume** when ready. |
| A challenger shows **Eligible** | It passed the test; auto-switch is off. | Press **Approve switch**, or leave it shadowing. |
| A challenger shows **Dropped** | It was worse than the active model on held-out data. | Nothing; next Sunday trains another. |
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
