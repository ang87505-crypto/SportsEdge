# Stocks: Alpaca 2026 engineering-only diagnostics

Status: **no historical backtest, no strategy P&L, no active trades**.

The source of truth is `research/stock_audit_20261012/protocol.json`.
The frozen development interval is **2000-2011**, validation **2012-2016**,
and sealed historical test **2017-2025**. Do NOT query the sealed set
in a casual engineering smoke test or reinterpret 2026 prices as the
registered development sample.

## Why Alpaca and what it does not solve

Alpaca can supply historical bars and a corporate-actions endpoint.
Its Basic plan provides free IEX market data, but a single-venue IEX volume
series does not satisfy the strategy's consolidated-volume threshold.
Alpaca documentation says historical SIP data older than 15 minutes may
be queried without a paid real-time plan; test actual account entitlement
before assuming availability, terms or zero provider charges.

Raw Alpaca pages do **not** attest past listed/delisted security membership,
permanent identities, late corrections and dividends, delisting recoveries,
or historical as-of availability. Its published historical stock range
begins in 2016, insufficient for the registered 2000-2011 development
window. No strategy historical backtest may be approved on this basis.

## Zero-network, zero-order plan (safe to run)

```bash
python -m analytics.alpaca_history_archive \
  --symbols AAPL,MSFT \
  --start 2026-03-02 --end 2026-03-06 --asof 2026-03-06 \
  --feed sip --max-requests 8
```

**No API calls occur** without `--execute-network`. Before any external
collection, the operator must verify provider terms and request allowance.
Only after that, choose a fresh output file and use local environment
variables `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`; never paste or
commit credentials. Network execution is expressly opt-in and read-only.

```bash
python -m analytics.alpaca_history_archive \
  --symbols AAPL,MSFT \
  --start 2026-03-02 --end 2026-03-06 --asof 2026-03-06 \
  --feed sip --max-requests 8 --execute-network \
  --output ./private-alpaca-2026-archive.json

python -m analytics.stock_alpaca_engineering_gate \
  --archive ./private-alpaca-2026-archive.json \
  --output ./private-alpaca-2026-integrity.json
```

Keep those files out of git until rights, privacy and storage requirements
are reviewed. The gate inventories page hashes, query ranges and per-symbol
presence, and reports explicit blockers. It intentionally **cannot** return
a true historical-backtest-ready status, estimate the strategy's earnings,
or qualify as the point-in-time universe preflight.

## Next engineering milestones

1. Land Astra's accounting-v2, candidate adapter, and universe-readiness
   packages on a separate reviewed stock branch; full Python tests must pass.
2. Reconcile authorized 2026 diagnostic raw pages against independent dated
   event/session definitions, without evaluating strategy outcomes.
3. Finish corporate events and real-market source contracts.
4. Obtain an approved point-in-time 2000-2011 development dataset,
   including delisted stocks and recoveries, with licensed permitted use.
5. Produce the pre-registered, after-cost baseline vs candidate comparison,
   with full uncertainty and benchmarks, once all data gates pass.

This work does not change or relax any registered strategy/version/protocol.
