# QuantConnect stream connectors: row assembler and Free-node memory probe

**Research infrastructure only.** No historical source is admitted, no strategy
backtest ran, and no performance was measured. No QuantConnect data was read,
exported or summarised for this work. Every test fixture is synthetic. The
memory probe has **NOT YET RUN IN QUANTCONNECT CLOUD**.

This branch (`research/qc-stream-connectors`) is stacked on draft PR #79
(`research/qc-historical-data-gaps`). It adds files only. It changes no file
from PR #53, #78 or #79, none of Astra's frozen strategy or protocol files, and
no paper-trading or Alpaca automation.

## What is built

### 1. `integrations/quantconnect/qc_stream_rows_v1.py` (row assembler)

Pure functions that turn in-cloud QC observations into exactly the row schema
that `IdentityDevelopmentStream.accept(row)` consumes:
`{session, evidence?, identity_records?}`.

| Function | Produces |
|---|---|
| `build_evidence(...)` | `{evidence: {shards, context, listings, decision_at}, identity_records}` for the first session of a month |
| `build_session(...)` | One accounting-v2 session: `date/open_at/close_at` from the reviewed calendar, `kind`, `raw`/`USD`, `actions_complete`, `actions_available_at`, `events`, raw-open `bid == ask` quotes (with `prior_adv20_shares`, `volume_available_at`, `volume_last_session`, `tradable`, sizes) and `close_marks` |
| `build_row(session, built=None)` | The stream row; evidence and identity records only on a decision session |
| `build_shard(...)` | One `{security_id, payload}` shard in the `parse_daily_bars` shape (also used by the probe) |
| `prior_adv20(...)` | The frozen scorer's trailing 20-session split-adjusted mean volume |
| `validate_session`, `apply_renames`, `member_symbols`, `reviewed_sessions`, `decision_window` | Helpers |

Inputs:

- **Bars:** the raw bar rows returned by `lean_reviewed_lookback_v1`. The
  lookback must still carry `requested_raw_unadjusted=True`,
  `requested_fill_forward=False`, `historical_source_admitted=False` and
  `performance=None`.
- **Events:** accounting-v2 events from `qc_lifecycle_mapper_v1.map_session`.
- **Actions:** `scoring_action` rows plus `security_id`.
- **Identity records:** `qc_identity_registry_v1.build_records` output for
  each permanent ID. The frozen `IdentityRegistry` re-checks them.
- **Calendar:** a REVIEWED calendar passed in (accounting-v2 shape).
  Sessions are never inferred from weekdays or from returned rows. Every bar
  date must match the reviewed calendar exactly.

Rules:

- **No invented availability.** Every `available_at` is an explicit input:
  per-session bar publication times, quote observation and availability, volume
  availability, close-mark availability, event and action availability, and
  universe/calendar/action provenance. `completed_at` is the reviewed session
  close.
- **Fixed codes on failure.** Any missing or ambiguous input raises
  `StreamRowBlocked`, whose `str()` is a fixed code with no data in it. This
  follows the `LifecycleBlocked`/`IdentityBlocked` pattern. Examples:
  `MISSING_SESSION_BAR`, `MEMBER_LOOKBACK_MISSING`,
  `BAR_AVAILABLE_AT_OR_AFTER_DECISION`,
  `BAR_DATES_DISAGREE_WITH_REVIEWED_CALENDAR`, `QUOTE_NOT_UNSPREAD_RAW_OPEN`,
  `EVENT_AVAILABLE_AT_OR_AFTER_OPEN`, `DECISION_NOT_FIRST_MONTHLY_SESSION`.
- **Missing bars block the session.** Every current-universe member must have
  a session bar, or the whole session blocks. Nothing is skipped or filled.
- **Short history gets no quote.** A member with fewer than 20 prior sessions
  gets a close mark but no quote. The frozen rules mean it can be neither held
  nor targeted.

### 2. `integrations/quantconnect/qc_memory_probe_main.py` + `qc_memory_probe_v1.py`

An optional, read-only QC `main.py`. It takes ONE first-of-month decision
(2001-02-01 08:00 New York, inside 2000–2011). It captures the full Morningstar
fundamental universe, reads each member's 253-session RAW lookback through
`lean_reviewed_lookback_v1`, and turns each lookback into a shard with
`build_shard`, keeping the bundle in memory. It logs only fixed codes:

```text
SPORTSEDGE_QC_MEMORY_{UNDER_256MB|256_512MB|OVER_512MB|PROJECTED_*|BLOCKED_<phase>};
SPORTSEDGE_QC_ELAPSED_{UNDER_1MIN|1_10MIN|10_60MIN|OVER_60MIN}; PROCESS_PEAK_<bucket>;
<COMPLETE|STOPPED_MEMORY_CAP|STOPPED_TIME_CAP>; COVERAGE_<...>; PROBE_ONLY; ...
```

It places no orders, subscribes to no universe, writes no files and exports
nothing. Logs carry no IDs, tickers, counts, prices, dates or exception text.

Two caps stop the run early:

- **Memory cap.** The run stops at a 512 MB bundle and reports `OVER_512MB`.
- **Time cap.** The run stops after 60 minutes and reports a `PROJECTED_`
  bucket, extrapolated from the members read so far.

To deploy it, upload these to the existing project:

- the `se_*` bundle from `scripts/package_stock_identity_cloud.py`, which
  supplies the RAW reader and the frozen `analytics` package;
- `qc_stream_rows_v1.py` and `qc_memory_probe_v1.py` as root files;
- the probe as `main.py`.

What the probe does not do:

- **Calendar.** Its calendar comes from LEAN's exchange hours. That is a
  probe-only stand-in, not the reviewed calendar.
- **Placeholders.** Its bar availability, 16:00 close and classification
  labels are placeholders. They never reach scoring, the stream or any
  decision.
- **Size estimate.** The bundle size is a conservative deep `sys.getsizeof`
  estimate. Process peak RSS comes from `resource` where available.
- **Not measured.** It does not measure scoring, identity normalization or the
  six-account stream.

## What is verified (locally, synthetic only)

GitHub Actions is billing-blocked, so CI did not run. Local results are below.

- **Exact row parity.** The existing `test_stock_identity_stream_v1` fixture
  was broken down into QC-shaped inputs and rebuilt. The rebuilt rows are
  **exactly equal** to the fixture's rows for all 23 sessions (2 decisions).
  The unchanged `IdentityDevelopmentStream` in synthetic mode accepts them.
- **Same results.** All six cost/strategy paths give the same statistics as
  `run_bundle` (the PR #50 reference). The final report is identical to the
  one built from the original fixture rows.
- **253 bars are enough.** A shard of exactly 253 lookback bars gives the
  same scoring `report_id` and prior inputs as the fixture's longer history.
- **ADV parity.** With a mapper-produced split inside the window,
  `prior_adv20` matches the frozen scorer's `prior_adv20_shares`.
- **Adversarial cases:**
  - missing quote bars, missing volume history, and bars for non-members;
  - a held security's dropped quote, rejected by the unchanged stream;
  - `bid != ask`, rejected by both the assembler and the stream;
  - late or missing bar availability, late provenance, late identity records,
    retrieval before the decision, and late action/volume/execution/event
    timing;
  - missing, extra or duplicate members;
  - extra, missing or unreviewed sessions, and a stale lookback;
  - a decision that is not the first session of the month or not at 08:00;
  - an extra stream row, rejected by the stream;
  - combined same-session events and events for non-members.
- **Probe tests.** Fake `AlgorithmImports` with the real RAW lookback reader
  and the real `build_shard`. Tests cover the bucket boundaries, the
  calendar-from-exchange-hours guard, unreadable members, both caps, and
  import, universe and schedule blocks. Every log line is checked against a
  fixed-code pattern with no IDs, tickers, dates or values. A source scan
  forbids order, export, file and network calls in all three new modules.

Suites: `python -m unittest discover -s integrations/quantconnect -p 'test_*.py'`
and `python -m unittest discover -s analytics -p 'test_stock_*.py'`. Results
are recorded in the PR description. The only failure is the known Windows-only
`test_cloud_identity` packaging failure, which is unrelated.

## What remains blocked

1. **Reviewed calendar.** No independently reviewed 1999–2011 exchange
   calendar exists yet. The assembler requires one. The probe's LEAN
   exchange-hours calendar is not a substitute.
2. **Dividend declarations.** LEAN supplies no pay date, currency, special
   flag or exact amount. `map_dividend` still needs a reviewed declaration per
   dividend.
3. **Terminal-event economics.** Delisting, merger, spinoff and recovery
   values are not in QC. Every terminal event still blocks.
4. **Benchmarks.** No licensed `broad_market_total_return` or
   `half_market_half_cash` series is connected. A historical `finish()`
   requires both.
5. **Review evidence.** Every `stock_development_runner_v1.REVIEWS` gate is
   still pending: source, availability, PIT universe, classifications,
   execution proxy and calendar. The availability inputs above must come from
   those reviews.
6. **Fractional-era prices (newly found).** The frozen stream spreads a raw
   open by ×0.9995/×1.0005, and accounting v2 admits at most 6 decimals. So a
   raw open needs at most 2 decimals. Pre-decimalization prices (sixteenths,
   e.g. 47.4375, before 2001) fail this. The assembler blocks them with
   `OPEN_PRICE_PRECISION_EXCEEDS_FROZEN_SPREAD_BOUND`. Fixing this needs an
   owner decision or protocol amendment. Nothing frozen was changed.
7. **Free-node memory is unknown** until the owner runs the probe. The probe's
   call shapes are unverified on the owner's runtime: History for unsubscribed
   universe symbols, `exchange.hours.is_date_open`, and the `resource` module.
   QC's file and runtime quotas for the added root files are also unverified.

Nothing here claims profitability or admits a source.
