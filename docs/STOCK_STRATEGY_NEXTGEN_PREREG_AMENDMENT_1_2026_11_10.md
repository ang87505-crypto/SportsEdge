# Amendment 1 to the next-generation pre-registration (2026-11-10)

**When:** written after the first run (GitHub Actions run 42866348222, code `892176e`) and **before any V5 result was
computed**.
**Why:** that run reported every V5 candidate as `BLOCKED_BY_POINT_IN_TIME_DATA`. SEC returned HTTP 404 for the
`2026q2` and `2026q3` Insider Transactions Data Sets; 2016q1–2026q1 (41 quarters) loaded and passed the column
contract.

## Change

**Unchanged:** the full-window V5 status stays **BLOCKED_BY_POINT_IN_TIME_DATA**. Nothing in the original
registration is edited.

**Added: a truncated-window evaluation.** The same three V5 candidates (`insider-only-v1`, `mq-insider-tiebreak-v1`,
`mq-insider-filter-v1`) are evaluated on the window that complete filings support:
- **Executions:** 2017-02-01 to **2026-04-30**.
- **Last decision:** the last month-end decision is 2026-03-31. It only reads filings dated before that session,
  all of which are in 2026q1 or earlier.
- **Paired baseline:** B0 is re-run on exactly the same window and data.
- **Unchanged rules:** costs, gates, bootstrap, feature definitions and the availability rule.
- **Label:** results are labelled `EXPLORATORY-TRUNCATED`. A pass would earn at most `QUALIFIES FOR INDEPENDENT REVIEW`
  for that window; it would not lift the full-window block.

**Forward collection:** when SEC publishes the missing quarters, the collector reruns unchanged and the full-window
evaluation can be repeated.
