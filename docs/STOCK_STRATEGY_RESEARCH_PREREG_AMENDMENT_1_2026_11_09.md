# Pre-registration amendment 1: data-integrity corrections (2026-11-09)

Written **after** the first real evaluation run was seen ([run 42710247709](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42710247709),
result `results/historical-2026-11-09T221552Z.json` on the `research-data` branch, dataset SHA-256
`6c31aa06…55db`) and **before** any rerun. That result is preserved unchanged and is **superseded**
because of the data defect below. The candidates' rules, windows, costs, comparisons and the nine
pass/fail conditions in `docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md` are unchanged. No
parameter is tuned.

## Defect 1: corporate actions applied to the wrong company (ticker reuse)

Alpaca keys corporate actions by ticker, and tickers are reused. In January 2022 the Roundhill
Metaverse ETF renamed `META` → `METV` so Meta Platforms could take `META`. The first run joined that
ETF's `METV` prices onto the `META` series from 2022-01-31. The ETF's earlier dividends could also have
been credited to Meta Platforms positions. The bars themselves (fetched `asof` the window end) were
correct, for the right company.

**Correction** (`analytics/research/data.validate_actions`): only corporate actions consistent with the
requested entity's own price history are applied.

- **Name changes:** dropped when the old and new symbol are the same, or when the old symbol keeps
  trading at or after the change date.
- **Cash mergers:** dropped when the symbol keeps trading more than 5 sessions afterwards.
- **Dividends and splits on a session** are checked together against that session's change in the
  back-adjustment factor (adjusted ÷ raw). They are dropped on a mismatch beyond 30% of the dividend
  yield (+0.002% for rounding), or 3% for splits.
- **Unverifiable actions:** an action on a day without a bar cannot be checked. It is kept and marked
  `unvalidated`.
- **Recording:** every dropped action is listed in the result file (`data.actions_dropped`).

**Affects:** every momentum-quality series from 2022-01-31, and any Berkshire series holding META.
Correctly renamed members (MMC → MRSH on 2026-01-14) are unaffected.

## Defect 2: QMOM holdings parser (no evaluation impact)

The parser read CSS classes that appear only after the page's JavaScript runs. The HTML the server
actually sends has the Effective Date and all 52 holdings rows, but without those classes. The first
two collections were therefore recorded as `PARSE_FAILED` and never used.

**Correction:** the parser now finds tables by their visible column headers. The server's real HTML is
a test fixture. A disclosed `CASH&OTHER` line is kept as a non-equity row and stays cash in the follower.

## Defect 3: forward ledger end date (no evaluation impact)

The forward step asked Alpaca for SIP bars through the current day, which the free plan refuses
(HTTP 403). Forward ledgers now end at the last completed day, which the nightly 02:17 UTC run
naturally covers.
