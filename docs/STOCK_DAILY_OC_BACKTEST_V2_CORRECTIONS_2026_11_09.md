# Daily open-to-close backtest: v2 corrections (written after v1 results, before any v2 result)

The v1 plan (`docs/STOCK_DAILY_OC_BACKTEST_PLAN_2026_11_09.md`), the v1 code
(`analytics/stock_daily_oc_backtest_v1.py` at commits 9719445 and 866794c) and the v1 results
(runs 42689444342 and 42690807640, both **NONE QUALIFIES**) are preserved unchanged. v2 is a
separate module, `analytics/stock_daily_oc_backtest_v2.py`, with its own workflow.

These corrections come from an independent review of commit 9719445. They were written after the
v1 results were seen. They fix defects and do not tune the rules: the five rules, their parameters,
the costs, the comparisons and the seven pass/fail conditions are unchanged. Daily-trading
activation stays off whatever v2 shows.

## Corrections

1. **Drawdown peak seeded with starting equity.** v1 set the peak at the first close, so a loss on
   the first session could never trigger the pause (a synthetic drop from $30,000 to $13,833 gave
   zero pauses and five more fills the next session). v2 starts the peak at $30,000.
2. **No automatic restart.** v1 assumed an owner review and resumed after five sessions. v2 halts
   new entries at the first trigger, and only an explicit owner authorization can resume. A
   replay has none, so the as-live series stays in cash from the trigger to the end. The halt
   date is reported.
3. **Unresolved overnight positions.** While any position is unresolved (no closing price on its
   entry day), v2 places no new entries. A rule with any unresolved exit in its as-live run
   cannot qualify (new check 8).
4. **Security identity.** v1 silently lost members whose ticker changed. v2 audits every member
   with missing bars in the evaluation window against Alpaca's corporate-action records
   (`/v1/corporate-actions`, name changes and mergers):
   - **Name change:** the new symbol's bars are fetched with the same parameters and joined at
     the change date. The adjusted series is rescaled so the adjusted return across the join
     equals the raw return.
   - **Cash or stock merger:** recorded as delisted on that date. The missing bars are correct,
     and no position can be stranded, because the strategy is flat overnight.
   - **Neither:** recorded as unexplained and listed in the report, never silently dropped.

   Expected from public sources (to be confirmed by Alpaca's records in the run): MMC became MRSH
   on 2026-01-14; EA was taken private for $210 cash and delisted on 2026-08-04.

## Verified data

The v2 run downloads the same base dataset as v1 and must reproduce the v1 fingerprint
`de8a61bddce7e07d9a9dce94d63649528bda44b4007b1eefe55e744c3748f085` (run 42689444342), or it stops.
The identity supplement (corporate-action pages and new-symbol bars) gets its own fingerprint.

## What the corrections affect

- **Corrections 1–2** change only the as-live series, which pass/fail uses. The no-pause
  diagnostic, the comparisons and the zero-cost runs are unaffected.
- **Correction 3** changes nothing in v1's numbers, which had zero unresolved exits.
- **Correction 4** changes every rule and the weekly comparison from 2026-01-14 (MMC/MRSH).
  SPY is unaffected.

## Added reporting (descriptive, not pass/fail)

- **Gross returns:** 0 bps, for the as-live and the no-pause series.
- **Net returns:** 5, 10 and 25 bps, as in v1.
- **Break-even cost per side:** the cost at which the no-pause series' net CAGR is zero, found by
  bisection between 0 and 25 bps. A rule that loses before costs has no break-even. The same is
  computed for SPY open-to-close.
