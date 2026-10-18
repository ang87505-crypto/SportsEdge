# QuantConnect LEAN 2.5 smoke failure: BLOCKED_FRAME and overload repair

Owner-provided native QuantConnect run: `SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_FRAME; NO_ORDERS; NO_PNL`, test on 2001-02-02. This **does not mean missing historical source data**: the API request was made and returned, but the adapter's DataFrame-processing assumption did not hold.

## Engineering change

Originally the adapter called:
```python
algorithm.history(symbols=[symbol], start=start, end=end, resolution=Resolution.DAILY, fill_forward=False, extended_market_hours=False, data_normalization_mode=DataNormalizationMode.RAW)
```
The Python LEAN API has distinct overloads for requests by `symbols` and DataFrame-returning `tickers`; the frame check did not pass on LEAN 2.5.0.0.18188. The new adapter requests the DataFrame overload with the **positional** symbol collection and positional start/end bounds:
```python
algorithm.history([symbol], start, end, resolution=Resolution.DAILY, fill_forward=False, extended_market_hours=False, data_normalization_mode=DataNormalizationMode.RAW)
```
This follows QuantConnect's documented Python DataFrame history request, avoids trying to interpret Sequence[Slice] as pandas, and preserves explicit RAW normalization and no fill-forward. Tests assert exactly one provider call with the correct positional arguments, no fallback to adjusted data or missing data, and fail-closed handling of unexpected return shapes.

## Next one-shot cloud validation

In the **existing** `SportsEdge-Stock-Research` project, copy the new versions of BOTH root files from draft PR #78:

- `integrations/quantconnect/lean_history_source_v1.py` -> `lean_history_source_v1.py` in QuantConnect.
- `integrations/quantconnect/qc_raw_history_smoke.py` -> `main.py` in QuantConnect.

Save both and run Build > Backtest one time. Possible fixed logs:
`SPORTSEDGE_QC_RAW_HISTORY_SMOKE_PASSED`,
`SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_FRAME_NON_DATAFRAME`,
`SPORTSEDGE_QC_RAW_HISTORY_SMOKE_BLOCKED_FRAME_NULL`, or another stage.

An actual PASS proves only that one bounded historical SPY raw price request returned a structurally valid DataFrame in-cloud; it does NOT approve the 2000–2011 full PIT stock source or certify historical trading profitability. No market data printed or exported; no orders. Do not create any paid account upgrades for this test.

API references:
- https://www.quantconnect.com/docs/v2/writing-algorithms/historical-data/history-requests
- https://www.quantconnect.com/docs/v2/writing-algorithms/historical-data/history-responses
- https://www.lean.io/docs/v2/lean-engine/class-reference/py/QuantConnect/Algorithm/_History/
