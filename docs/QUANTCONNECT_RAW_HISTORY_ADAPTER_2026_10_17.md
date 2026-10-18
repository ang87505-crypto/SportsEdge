# SportsEdge QuantConnect RAW History Reader — October 17, 2026

## Actual delivered engineering

`integrations/quantconnect/lean_history_source_v1.py` is the first **live QuantConnect History API acquisition step** toward a source provider for the frozen 2000–2011 research replay. It is intentionally NOT the full `metadata/evidence/header/rows/benchmarks` implementation: that implementation cannot be safely claimed until exchange calendars, source publication times, corporate-action events, and the full PIT universe have been independently reviewed.

The adapter:

1. Calls LEAN's `algorithm.history` from inside the QuantConnect cloud using **explicit RAW normalization, daily resolution, no fill-forward, no extended-hours** and a stable LEAN `Symbol` ID.
2. Caps requests at 40 calendar days / 40 daily observations, so a full research run would need bounded pagination.
3. Checks half-open exchange-local request bounds against the frozen **08:00 ET** decision, and rejects out-of-window dates, duplicate/unordered dates, wrong IDs, invalid or nonfinite OHLCV, and fractional/negative volume.
4. Returns internal Python raw bar observations with names that do not assert historical publication availability. These are **not allowed to leave the QuantConnect environment** or enter the frozen selector/accounting without later independent validation.
5. Returns explicit `historical_source_admitted=false`, `strategy_backtest_completed=false`, `performance=null` and permanent blockers. It does **not** place orders, export market data, compute trade signals, or alter a strategy.

The adapter is also included by the existing `scripts/package_stock_identity_cloud.py` hash-bound Free-node code package, inheriting Astra's original `cloud_identity.run_in_cloud(source)` fail-closed gateway unchanged. Offline adversarial tests under `test_lean_history_source_v1.py` use a fake LEAN History API without provider access. GitHub CI uses Python 3.12/3.13 and additionally reruns the existing QC unit tests.

### Reproduction

```bash
python -m unittest integrations.quantconnect.test_lean_history_source_v1 -v
python -m unittest discover -s integrations/quantconnect -p 'test_*.py' -v
python -m unittest analytics.test_stock_identity_bridge_v1 analytics.test_stock_identity_stream_v1 -v
python scripts/package_stock_identity_cloud.py --output /tmp/sportsedge-qc-new-package-dir
```

### Expected QuantConnect call (inside a QCAlgorithm; not a standalone local script)

Once the versioned code-only package is installed and `se_bootstrap.install()` has run from an isolated cloud research kernel:

```python
from datetime import datetime
from integrations.quantconnect.lean_history_source_v1 import read_raw_window

# Example of a SINGLE bounded request; the Symbol must come from the
# actual point-in-time QC universe, not a present-day ticker-only list.
snapshot = read_raw_window(
    algorithm, historical_symbol,
    start=datetime(2001, 1, 2),
    end=datetime(2001, 1, 31),   # exclusive exchange-local bound
    decision_at=datetime(2001, 2, 1, 8),
)
# Keep snapshot INSIDE QC; do not print/serialize/upload any bars or IDs.
assert snapshot['historical_source_admitted'] is False
```

The example illustrates the API contract, not an authorized research observation or approved historical symbol/date. The default code-only package does not place this call automatically and retains **no** external market-data dependencies.

## Why this still does not produce actual strategy P/L

- Raw History API observations do not identify historical publication/revision dates or independently establish what was available strictly before 08:00 ET.
- A LEAN `Symbol.ID` is not proof of reviewed eligible PIT NYSE/NASDAQ/AMEX common-stock membership, historical sectors/exchanges or first listing dates. Morningstar coverage is not identical to the frozen full market.
- Missing trading days require an independently reviewed exchange calendar; no weekday assumptions or filling.
- Corporate actions, splits/dividends, mergers, spinoffs, liquidations and price/volume adjustment parity require separate source checks and a lifecycle-aware accounting extension. Unsupported actions must abort; never silently ignore delisted losers.
- The existing replay still requires six full-account paths (baseline/candidate × 15/25/50 nominal bps), benchmarks and registered 2000–2011 development history with 1999 warmup, then separate 2012–2016 validation. Do NOT inspect the reserved 2017–2025 holdout for tuning.
- QC cloud data and reconstructable transformations remain in QC. Normal allowed aggregate strategy metrics may only be shared under provider terms; no market-data export is part of this feature.

## Operator instructions and next engineering steps

**No owner action is required for this PR.** Leave the currently successful `SportsEdge-Stock-Research` diagnostic in place. Do not replace `main.py` with this module or try to backtest the full strategy with two tickers. Once independent QA on this PR passes, a reviewed source-provider implementation will use these bounded RAW observations within QC and connect them to the already-built identity/economics replay in PR #53, with source availability and lifecycle certification handled separately.

Next implementation milestones:

1. Verify the exact QC History API signature on the user's free runtime, without logging dataset values, and instrument QC-only dates/coverage under source rights.
2. Implement the **complete PIT security registry/sector/exchange and source vintage adapter**, matching `stock_identity_bridge_v1.FIELDS`.
3. Add source event and holiday calendars with independent as-of publication evidence. Repair unsupported lifecycle economics separately; never replace them with last-price liquidation.
4. Implement `metadata/evidence/header/rows/benchmarks` against QC in-cloud sources and run the unchanged `safe_cloud_run`/six-account replay. Keep all detailed evidence in cloud until independent QA.
5. Validate real after-cost results in the registered development protocol. This is NOT that milestone.

No paid subscription, Alpaca credentials, market-data download, broker order, Supabase write, modified frozen algorithm or production deployment is required for this PR.
