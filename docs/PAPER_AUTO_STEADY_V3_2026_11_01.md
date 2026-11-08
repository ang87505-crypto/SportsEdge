# Second weekly paper strategy: steady stocks (`stock-v3-steady-weekly-1`)

Date: 2026-11-01. Requested by the owner: "second strategy, maybe combine them", then chosen
from the offered options:
- **side by side**, each strategy on its own Alpaca PAPER account;
- **steady stocks** (low volatility) as the second strategy.

"Combined" is the two accounts added together, which is a 50/50 mix.

**This is not research evidence.** The strategy has no historical test. Its universe is a
current, hand-reviewed large-cap list, so it is exposed to survivorship bias. The results are
paper fills.

## The strategy

Model `stock-lowvol252-trend200-v1`, in `analytics/stock_lowvol_weekly_v1.py`. It was frozen
before any data was seen and has no fitted parameters.

| | Momentum (`stock-v2-weekly-1`) | Steady stocks (`stock-v3-steady-weekly-1`) |
|---|---|---|
| Universe, decision time, data, skips, $95 price cap | Shared | Shared: one sealed capture for both |
| Validation and scores | `stock_weekly_scoring_v2` | The same scores |
| Must pass | $5 price, $20M average dollar volume, W_T above its 200-session mean, 12-1 momentum > 0 | $5 price, $20M average dollar volume, W_T above its 200-session mean |
| Ranked by | 12-1 momentum, highest first | Volatility of the 252 daily total returns (W_t / W_(t-1) - 1, sample standard deviation), lowest first |
| Picks | At most 5, at most 2 per sector | At most 5, at most 2 per sector |
| Sizing, planner, limits, controller, STOP | Shared | Shared |

Volatility uses the frozen `total_return_index` on the same raw closes and the same split and
dividend records the scorer used, so a split does not look like a crash (this is tested). The
signal keeps the `stock-forward-signal-v1` format, with `variant.selection` set to
`lowest-252-session-volatility-trend200`.

## What changed

**Database: `database/staging/paper_auto_models_v3.sql`**
- This is an idempotent upgrade that adds the model to the `experiments.model_version` check
  and to the register RPC.
- The register function is otherwise identical to the one in `paper_auto_v1.sql`; a fresh
  install includes the same change.
- It changes no data, gates, limits, grants, policies, broker access or schedules.
  `CREATE OR REPLACE` keeps the function's owner and its service-role-only grant (checked).
- The SQL contract test now registers a steady-stocks experiment. It also refuses a misnamed
  model and refuses a second experiment on an account that is already registered.
- CI tests three paths: a fresh install, the pinned previous schema upgraded with risk v2 and
  then v3, and the schema installed on staging today with v3 applied twice.

**Allowlists**
- The controller's `REGISTERED_MODELS` and the planner's `MODELS` now name the model.
- Sizing rules are identical for every model (this is tested).

**Accounts: `src/lib/server/paper-auto-accounts.ts`**
- Each experiment uses only its own key pair:
  - steady stocks uses `ALPACA_PAPER_AUTO_2_KEY_ID` / `ALPACA_PAPER_AUTO_2_SECRET_KEY`;
  - every other experiment keeps `ALPACA_PAPER_AUTO_KEY_ID` / `ALPACA_PAPER_AUTO_SECRET_KEY`.
- There is no fallback between pairs.
- Before the second pair exists:
  - manual runs report `NOT_CONFIGURED`;
  - scheduled runs exit quietly with `NOT_CONFIGURED_SKIP`.
- Before registration, scheduled runs exit with `NOT_REGISTERED_SKIP`.

**Workflows**
- **Worker:** runs once per experiment (a matrix), each run in its own concurrency group.
- **Weekly decision:**
  - makes one shared capture, read with the first pair's keys (read-only market data);
  - then makes one decision per registered experiment;
  - one experiment's failure never stops the other's decision, but the run still fails.
- **Owner workflow:** passes both pairs, and the worker picks the right one.

**Autopilot page**
- When two or more strategies are registered, a "Your strategies" table shows each one plus
  a Combined row.
- The Combined return appears only when every strategy has a verified return; nothing is
  estimated.
- A **Stop all** button stops every strategy.
- A switcher chooses which strategy's full view is shown. Each view keeps its own Start and
  Stop.
- The top-bar pill and the Stocks card summarise all strategies, for example
  "1 of 2 running".

## Owner steps (once)

1. **Alpaca.** Create a second PAPER account with $1,000 and generate its API keys.
   - Alpaca allows up to three paper accounts.
   - The account must be flat and used only by this experiment.
2. **GitHub secrets.** Add `ALPACA_PAPER_AUTO_2_KEY_ID` and `ALPACA_PAPER_AUTO_2_SECRET_KEY`.
3. **Supabase staging (`vfyzbliksooljxrlfadp`).** Run `database/staging/paper_auto_models_v3.sql`
   once in the SQL editor. It is safe to run again.
4. **Register.** Run Actions → *Recurring PAPER owner action* → `register`,
   `stock-v3-steady-weekly-1`. It registers STOPPED.
5. **Vercel Production.** Set `SPORTSEDGE_PAPER_AUTO_EXPERIMENT_IDS` to
   `stock-v2-weekly-1,stock-v3-steady-weekly-1`, then redeploy.
6. **First decision.** The next Monday's scheduled decision includes it. To start mid-week,
   dispatch the weekly decision with this experiment and `initial` = true before 07:55 New York.
7. **Start.** Press Start for Steady stocks on the Autopilot page, or run the owner action
   `resume`.

## Release state

The release switches are unchanged. Broker writes follow the shared `brokerWritesEnabled`
switch: once paper orders are on, an armed steady-stocks gate trades its own account under
the same limits. Real money stays off.
