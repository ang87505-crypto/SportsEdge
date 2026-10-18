# QuantConnect raw History API milestone: native PASS and 253-session collector

## Verified native QuantConnect signal

The owner's **QuantConnect Cloud, LEAN 2.5.0.0.18188** completed the first
read-only RAW SPY history reader smoke with:

```text
2001-02-02 16:00:00 SPORTSEDGE_QC_RAW_HISTORY_SMOKE_PASSED; SOURCE_NOT_ADMITTED; NO_ORDERS; NO_PNL
```

The earlier failed run showed `BLOCKED_FRAME`; the repaired Python DataFrame
History overload (`history([symbol], start, end, ...)`) now worked in-cloud.
This verified only a small bounded January 2001 sample (not a real strategy
backtest, a reviewed historical dataset, a complete universe, or algorithm P/L).
Original diagnostic output of 1,112,724 processed data points 2000–2011 remains
separate from this read-only History smoke.

## New engineering

`integrations/quantconnect/lean_reviewed_lookback_v1.py` adds
`read_reviewed_lookback(algorithm, symbol, expected_sessions, decision_at)`:

- Accepts an **explicit 253-day historical exchange calendar** provided and
  reviewed by an independent source process. It never invents sessions by
  filling weekdays, using current tickers, or trusting only the rows returned
  by QuantConnect.
- Preflights sorted unique canonical YYYY-MM-DD sessions with bounded lookback,
  closed sessions strictly prior to 08:00 ET decision time, and finite maximum
  pagination.
- Calls the already native-verified in-cloud RAW History reader in blocks of
  at most 35 calendar days (no fill-forward, no extended-hours, no data export).
- Requires **exact** bar/session coverage in each page, rejecting missing,
  extra, duplicate or misordered observations; rejects partial batches
  instead of interpreting them as zero returns.
- Collects only in-cloud raw observations and returns permanent
  `historical_source_admitted=False`,
  `expected_calendar_independently_verified=False`, `performance=None`.
- Preserves the existing frozen scoring/identity/accounting math and order
  prohibition. The reader makes no calls to Alpaca, brokerage, or Supabase.

Its fake-LEAN tests deliberately exercise full 253-session acceptance and
fail-closed behaviors for missing/extra dates, duplicated/partial calendars,
invalid decision cutoffs, and code-only cloud packaging. All tests use synthetic
values only; no historical provider data is transferred to GitHub.

## Remaining barriers to a defensible REAL 2000–2011 stock backtest

1. Independently review an as-of eligible, delisting-inclusive point-in-time
   NYSE/NASDAQ/AMEX common-stock universe with permanent security IDs.
2. Review daily raw consolidated OHLCV, publication/correction timestamps
   and complete market calendar as of every 08:00 ET monthly decision.
3. Review historical sector, exchange, listing, ticker/identity changes and
   corporate action economics (including mergers, spinoffs, delistings).
4. Implement the exact licensed, in-QuantConnect
   `metadata()/evidence()/header()/rows()/benchmarks()` provider for
   `integrations/quantconnect/cloud_identity.py`. Existing gates fail closed
   without all reviews; no source certification is silently inferred.
5. Produce and reconcile all six unchanged original model/account variants,
   cost assumptions, registered benchmarks and the **2000–2011 only** study.
   Keep the 2012–2016 validation and 2017–2025 sealed holdout separately
   reserved. The 2022–2025 Alpaca AAPL/MSFT archive is for source plumbing,
   never a substitute for eligible PIT market-wide development data.

The 253-session collector is production-independent *research infrastructure*:
it does not alone establish complete historical coverage or any return.
There is no need for the owner to repeat the already-passed smoke test.
