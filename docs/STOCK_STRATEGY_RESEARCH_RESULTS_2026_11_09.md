# Stock strategy research: first results (2026-11-09)

**Overall: NONE QUALIFIES.** No candidate is activated. Broker writes stay off. The rules in
`docs/STOCK_STRATEGY_RESEARCH_PREREG_2026_11_09.md` and amendment 1 are unchanged after these results.

All runs use the $30,000 paper capital, read-only Alpaca market data (SIP daily bars, raw and adjusted,
fetched `asof` the window end) and the pre-registered window: first execution 2017-02-01, end 2026-11-06.

## Runs and artifacts

Everything is committed append-only to the `research-data` branch.

| Run | What | Result file | Status |
|---|---|---|---|
| [42710247709](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42710247709) | First historical replay | `results/historical-2026-11-09T221552Z.json` | **Superseded** by amendment 1 (META/METV ticker reuse). Preserved unchanged. |
| [42711610908](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42711610908) | Corrected historical replay | `results/historical-2026-11-09T222445Z.json` | **Current.** NONE QUALIFIES |
| [42711611478](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42711611478) | Nightly collection | snapshots in `manifest.jsonl` | QMOM OK; SEC NOT_CONFIGURED; forward step failed (defect 4) |
| [42712625737](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42712625737) | Full evaluation after the defect 4 fix (all steps green) | `results/historical-2026-11-09T223137Z.json`, `reports/LATEST.md` | **Reproduced** the same dataset fingerprint and verdict; forward: `NO_FORWARD_SESSIONS_YET` |

**Fingerprints of the current result:**

| Item | SHA-256 |
|---|---|
| Dataset (sessions, bars, applied actions) | `9b53d64da9f5153c0fd000433d9ba386cd97e0635688c2cd45e7c14c99d9ad7e` |
| Raw corporate-action pages | `739736dfaa92218baacf0764757603809b87e2f76210ae6a9010cf459d8992d6` |
| Registry (`config/research/registry.json`) | `498d9977c9672387718958da2b7cff6e8a7bd6ea8bae772854aa0e5bb0565cc0` |
| Code commit | `8b633865b5a2c632a9ceaeb8eec2ffe0186b119b` (reproduced at `8fcc6bf867bd877e157000ab4355709a5bb32040`) |
| `analytics/research/engine.py` | `2fb4d4cf0ac623d3587683da47b45d9c86fa87498a38a78ded5837ffc9835adb` |
| `analytics/research/candidates.py` | `7368af5c0fc208272708178a6a25fe04fc291a1e118a6b6008f210d708b3933a` |

The first, superseded run had dataset `6c31aa06…55db`.

**Data checks on the current dataset:**

- 140 symbols have bars; none are missing.
- 5,293 corporate actions were applied.
- 0 raw-versus-adjusted integrity mismatches.
- One rename join: MMC → MRSH on 2026-01-14.
- 19 actions were dropped by the entity check (see the limitations section).

## momentum-quality-paper-v1: FAILS

| Series | CAGR | Total return | Max drawdown | Sharpe | Turnover/yr | Avg exposure | Costs paid |
|---|---|---|---|---|---|---|---|
| Continuous, gross (0 bps) | 17.6% | +386% | −35.0% | 0.78 | 9.8× | 97% | $0 |
| Continuous, 5 bps | 17.0% | +361% | −35.3% | 0.75 | 9.8× | 97% | $4,199 |
| **Continuous, 10 bps (judged)** | **16.4%** | **+339%** | **−35.1%** | **0.73** | 9.8× | 97% | $8,127 |
| Continuous, 25 bps | 14.7% | +280% | −35.4% | 0.68 | 9.8× | 97% | $18,439 |
| As-live, 10 bps (halts at −10%) | 3.4% | +38% | −10.1% | 0.58 | 1.0× | 10% | $382 |

- **As-live series:** with the pre-registered 10% halt and owner-only resume, the as-live ledger halted
  on 2018-02-08 (at 5 and 10 bps) or 2018-10-10 (at 0 and 25 bps). It then sat in cash, because no owner
  resume is assumed.
- **Unresolved positions:** none at any cost level, including 25 bps.
- **Ending state (continuous, 10 bps):** ending value $131,662 and ending cash $2,306.
- **Halves (continuous, 10 bps):** 19.6% CAGR in the early half and 11.7% in the late half.
- **Calendar-year returns (10 bps):**

  | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 YTD |
  |---|---|---|---|---|---|---|---|---|
  | +4.0% | +29.8% | +60.3% | +13.4% | −11.7% | +21.4% | +13.6% | +6.5% | +4.0% |

**Comparisons over the same window:**

| Comparison | CAGR | Max drawdown | Sharpe |
|---|---|---|---|
| SPY buy and hold | 14.5% | −33.8% | 0.84 |
| SPY, exposure-matched to the candidate | 13.9% | −33.4% | 0.83 |
| Weekly strategy replay, 10 bps (stock-v2-weekly-1) | 6.1% | −24.8% | 0.52 |
| QMOM buy and hold | 10.8% | −40.5% | 0.51 |
| BRK.B buy and hold | 13.6% | −29.6% | 0.75 |

**Pre-registered checks (continuous, 10 bps, unless the check says otherwise):**

| Check | Result |
|---|---|
| CAGR positive at 10 and 25 bps | pass |
| CAGR above exposure-matched SPY | pass |
| Sharpe above SPY buy and hold | **FAIL** (0.73 vs 0.84) |
| Sharpe above the weekly strategy | pass |
| Max drawdown within 35% | **FAIL** (−35.1%) |
| Both halves positive | pass |
| At least 6 positive calendar years | pass |
| No unresolved positions at any cost level | pass |
| Halt-exit loss within 15% | pass |

The drawdown failure is narrow (−35.1% against a 35% limit). Per the pre-registration, this is not a
reason to loosen the limit or re-run with different parameters: the candidate fails.

## qmom-disclosure-follower-v1: forward only

Old QMOM holdings cannot be reconstructed from today's page, so this candidate has no historical replay.

**Collection:**

- The official holdings page was collected successfully (status OK).
- It lists 52 rows with weights summing to 99.96%.
- One row is `CASH&OTHER`, which is kept as a non-equity line and stays cash in the follower.
- The real server HTML is stored as a test fixture: `analytics/research/fixtures/qmom/qmom_static_tables_2026-11-09.html`.
- The snapshot is in `manifest.jsonl` on `research-data`.

**Forward ledger:** it starts with the first eligible session on or after 2026-11-10. Before qualifying it
needs the pre-registered forward minimum (at least 252 sessions and the decision counts in the
pre-registration). Current forward sample: **0 sessions**.

## berkshire-13f-top5-paper-v1: blocked on owner setup

SEC EDGAR requires a contact in the User-Agent. That contact comes only from the repository secret
`SEC_EDGAR_USER_AGENT`, which is not set yet, so every SEC collection is recorded as `NOT_CONFIGURED`.
No filing has been fetched or guessed.

The parser is tested on real Berkshire filing records, stored in `analytics/research/fixtures/sec/`:

- the submissions JSON (13F rows only);
- the index;
- `primary_doc.xml`;
- the information table for accession `0000950123-25-008361`.

Once the secret exists, the historical replay of this candidate will run on the next evaluation.
It uses acceptance timestamps, amendment handling and execution at the session after acceptance.

## Defects found by the real runs, and what changed

| # | Found in | Defect | Fix | Effect on results |
|---|---|---|---|---|
| 1 | First historical run | Alpaca keys corporate actions by ticker; the ETF that renamed META → METV in 2022 was joined onto Meta Platforms | Entity check on every action (amendment 1) | First result superseded; current result above |
| 2 | First collection | QMOM parser relied on CSS classes added by the page's JavaScript | Parse by visible column headers | None (no data used) |
| 3 | First evaluation | Forward step asked for same-day SIP bars (free plan refuses, HTTP 403) | End at the last completed day | None |
| 4 | Run 42711610908 | Forward step sent the disclosed `CASH&OTHER` line as a ticker (HTTP 400) | Request only exchange-style tickers; record the rest in `data.symbols_rejected` | None (forward has no sessions yet) |

Defect 4 was fixed in commit `8fcc6bf`. It has a regression test in
`analytics/research/test_data_integrity.py` (`MarketSymbols`).

## Limitations

- **Small real dividends dropped as unverifiable.** The entity check dropped 13 real NVDA dividends
  (2020–2024) and one OXY dividend. Their yields (0.003%–0.03%) are smaller than the rounding in Alpaca's
  adjusted prices, so the footprint test cannot confirm them.
  - Upper bound on the error: under 0.4% of the NVDA position's value summed over four years, or under
    0.1% of portfolio value. No verdict is affected.
  - A tolerance change would be a new amendment, written before any rerun; none is made here.
- **Other dropped actions:**
  - META → METV rename (correct: it was another company);
  - XOM self-rename;
  - three QMOM dividends without a footprint;
  - a HON "split" on 2026-06-29 whose 4.8% footprint looks like a mislabeled distribution. The candidate
    did not hold HON in any rebalance from December 2024 onward.
- **Survivorship:** the universe is the committed large-cap list as known now. It is not a point-in-time
  index membership, which tends to flatter historical returns.
- **Cost model:** costs are flat bps per trade, not modelled spread or market impact.
- **QMOM follower:** forward only, with no historical evidence. 0 forward sessions so far.
- **Berkshire candidate:** not evaluated until the SEC secret is set.
- **Schedules:** the nightly and monthly schedules only run from the default branch, so they start once
  this branch is merged. Until then the workflows run on pushes to the research branch.

## Owner steps

1. **Add the SEC secret.** Go to Settings → Secrets and variables → Actions → New repository secret.
   - Name: `SEC_EDGAR_USER_AGENT`.
   - Value: a short app name and a contact address, for example `SportsEdge-research you@example.com`.
   - The value stays in GitHub secrets and is never committed.
2. **Re-run the evaluation.** Open the latest "Research evaluate (monthly)" run on this branch and
   choose "Re-run all jobs". A re-run reads secrets fresh. This collects the Berkshire filings and replays
   that candidate. The "Run workflow" button only appears after merge, because GitHub lists dispatchable
   workflows from the default branch.
3. **Review and merge the PR** so the nightly collection and monthly evaluation run on schedule.

Nothing else is needed. No paid data plan is used.
