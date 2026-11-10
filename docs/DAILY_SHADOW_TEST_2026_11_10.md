# Daily open-to-close: one-session forward observation, November 10, 2026

Registered before the session. Research only; no Alpaca orders, account changes, database writes,
strategy activation or weekly-rule changes. Historical result remains **NONE QUALIFIES** (PR #109).
This one-day observation cannot qualify a rule, estimate a reliable win rate or establish profitability.

## Frozen protocol

- Compare all five failed daily rules without tuning: losers5, gainers5, losers5-spy200,
  losers5-volz, losers5-spy200-sector2. The selector functions are copied unchanged from commit
  `7791a7cea76850bcfb5365f998ab8c8f959864e3`; their source-text fingerprint is checked in tests.
- Prospective universe: the existing large-cap list, with MMC replaced by its current MRSH symbol
  and delisted EA removed. The explicit snapshot is `config/research/daily-shadow-20261110.json`.
  This does not revise the historical test or the weekly bot's universe. Missing history is listed.
- Each rule has an independent $30,000 virtual book. Maximum five stocks, 20% each, whole shares.
- A frozen plan must be saved before November 10's exchange open, after the prior session's final bars.
  Only bars through November 9 may enter selection, sizing or limits. If that plan is missing after
  the open, the test is missed; later prices cannot reconstruct it.
- Simulate limit-on-open buys at the previous raw close plus 3%, sizing with a 25 bps reserve.
  An opening gap above that limit leaves the virtual order unfilled. Approximate exits at the day's
  raw close. Daily bars approximate auction executions; no actual broker fills are claimed.
- Report dollars before costs and after 5, 10 and 25 bps on each side. Use the same frozen shares at
  every cost. Compare an independently sized SPY open-to-close control. No annualization.
- Missing opens or exits mean unknown results for that rule. No automatic restart, tuning or promotion.
- Capture raw input receipts and SHA-256 fingerprints. Plans, raw inputs and results are append-only
  under `research-data/daily-shadow-20261110/`. Duplicate starts reuse the existing plan/result.

## Automation and owner use

Merging the workflow starts a plan capture tonight from completed November 9 bars. GitHub's November 10
04:10 AM MST slot and Vercel's 5 AM hour back it up. A late plan fails instead of pretending it was timely.
Grading is planned for 3:40 PM MST; Vercel's 5 PM hour backs it up. These are target times, not receipts.
The date guards make the backups inert after this one session. GitHub's yearly cron is skipped after 2026.

Result: https://github.com/ang87505-crypto/SportsEdge/blob/research-data/daily-shadow-20261110/REPORT.md

Both phases run on GitHub/Vercel using existing market-data credentials, without an AI conversation,
an open browser or a personal computer. The weekly bot's November 16 supervised acceptance and PR #102
remain separate. This test does not satisfy that release gate.
