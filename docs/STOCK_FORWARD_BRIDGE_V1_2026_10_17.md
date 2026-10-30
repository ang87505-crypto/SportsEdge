# Current-data bridge for the frozen forward signal (v1)

Date: 2026-10-17. Status: **code-ready, fail-closed and not run against real data.**
- No Alpaca request has been made.
- No market data has been downloaded.
- No security master has been created.
- No decision has been recorded.

`analytics/stock_forward_bridge_v1.py` builds the exact source envelope that Astra's
`analytics/stock_forward_signal_v1.forward_signal` accepts, and calls that function
unchanged. The bridge changes no strategy rule, model, protocol or sealed data.

## Sources and identities

| Input | Source | Notes |
| --- | --- | --- |
| Exchange calendar | Alpaca PAPER `GET /v2/calendar` | Real sessions, including early closes. |
| Listed securities | Alpaca PAPER `GET /v2/assets?status=active&asset_class=us_equity` | Kept only for the registered exchanges NYSE, NASDAQ and AMEX. The id is `alpaca:<asset uuid>`. |
| Daily bars | Alpaca data `GET /v2/stocks/bars`, `feed=sip`, `adjustment=raw` | Consolidated volume; no IEX substitution. Historical SIP more than 15 minutes old is free. |
| Corporate actions | Alpaca data `GET /v1/corporate-actions` | Splits and cash dividends are supported; anything else rejects. |
| Security type, sector, first trading date | **Registered security-master snapshot (owner/Astra)** | Alpaca does not provide them. |
| Action coverage completeness | **Registered attestation (owner/Astra)** | Required before `actions_complete=true` can be declared. |

All requests are read-only GETs to the two fixed Alpaca hosts. A shared rolling limiter keeps them at 190 per minute, below the free plan's 200. Every page is hashed into the decision's revisions, and nothing runs without `--execute-network`.

## Why two observations

The frozen data contract (`stock_data_contract.visible_at`) refuses a dataset retrieved before the decision ("cannot audit future visibility"), but every bar must be available strictly before it. The bridge therefore observes the bars twice:

1. **Reference capture, before 08:00 New York:** the calendar, assets, corporate actions and every member's bars. This observation proves availability before the decision (`available_at`).
2. **Decision capture:** starts at or after 08:00:00 and is sealed within 60 seconds. It re-reads the same bar queries, which proves nothing visible at the decision is missing (`retrieved_at`).

A bar is used only when both observations agree. A bar that changed, appeared only at the decision, or is missing rejects the whole decision.

## Outcomes (one record per first session of a month, 2026 only)

| Outcome | When |
| --- | --- |
| `TARGETS` / `HOLD_NO_TARGETS` | `forward_signal` succeeds. HOLD means no name qualifies. |
| `MISSED` | Any of: a reference source retrieved at or after 08:00; a decision capture started before 08:00 or sealed more than 60 seconds after it; an incomplete capture. Nothing is backdated or traded late. |
| `INPUT_REJECTED` | Any missing, contradictory or unsupported input, with named reasons. Examples: `SECURITY_MASTER_INCOMPLETE`, `SECURITY_MASTER_CONTRADICTS_BROKER`, `MISSING_OR_CONTRADICTED_BARS`, `BARS_CHANGED_BETWEEN_OBSERVATIONS`, `UNSUPPORTED_CORPORATE_ACTION`, `AMBIGUOUS_SAME_DAY_ACTIONS`, `ACTION_COVERAGE_NOT_ATTESTED`, `HELD_SECURITY_NOT_IN_UNIVERSE`, `FROZEN_SIGNAL_REFUSED:<reason>`. |

Records go to the recurring controller's `record_decision`. The database re-checks that each record is bound to the experiment, model, decision time and 60-second capture.

The decision workflow (`.github/workflows/paper-auto-decision.yml`) is dispatch-only. It runs four steps:
1. `paper-auto-worker.ts context` reads the registration and reconciled holdings.
2. `capture` collects both observations.
3. `decide` computes the frozen signal with no network.
4. `paper-auto-worker.ts decision` records it.

The workflow keeps the gzipped capture as an audit artifact for 30 days.

## Policy gaps flagged for Astra (not changed here)

With these gaps unresolved, a faithful run is expected to return `INPUT_REJECTED`. **No substitute universe is invented.** A narrower or reclassified universe would be a separately registered experiment, not this frozen model.

1. **Sector taxonomy.** The protocol requires "as-of sector classifications" and a 2-per-sector cap, but does not register a taxonomy (GICS, SIC divisions, and so on). The cap's effect depends entirely on that choice.
2. **Security type.** The universe admits only common stocks and excludes ETFs, preferreds, ADRs, funds and warrants. Alpaca's asset list has no security-type field. Free candidates such as Nasdaq Trader symbol directories (which carry ETF flags and security names) and SEC EDGAR SIC codes would need registration as the classification source.
3. **First trading date.** `listings.first_traded_on` means the earliest public trading of the security. Alpaca history starts in 2016 and cannot supply it.
4. **Zero-trade sessions.** A member with no bar for one session fails the **whole** batch, and forward-filling is forbidden. In a universe of about 4,000 listed common stocks, some illiquid or halted name very likely lacks a bar every month.
5. **Unsupported corporate actions.** The frozen model represents only splits and cash dividends. A spin-off, stock dividend, merger or symbol change touching any member inside the 253-session window rejects the whole decision, and such events occur somewhere in the universe almost every year.
6. **Same-day split and dividend.** The units are ambiguous in Alpaca's feed, so these are rejected rather than guessed.
7. **Remaining decisions.** The forward signal admits 2026 decisions only, so **2026-11-02 and 2026-12-01** are the only possible sessions. The 2027 reserve needs a separate pre-start registration.
8. **Timing.** The full-universe re-read at 08:00 is about 115 paginated requests, which must finish within 60 seconds and under the per-minute limit. This is feasible on a GitHub runner but not guaranteed; a slow provider means `MISSED`.

## Verification

- `python -m unittest analytics.test_stock_forward_bridge_v1`: 15 tests on synthetic captures, with no network. They cover:
  - targets from the unchanged frozen signal, with determinism and order independence;
  - type, exchange and coverage rules;
  - missing, changed and unseen bars;
  - unsupported and ambiguous actions, and a supported split that leaves the selection unchanged;
  - the attestation;
  - every MISSED path, the session rules and HOLD;
  - held identities;
  - the two-phase capture with fixed hosts, SIP raw bars and pagination;
  - the rolling limiter;
  - the record contract.
- The full Python suite passes, run as CI runs it: 256 tests.
- `src/lib/server/paper-auto-controller.test.mjs` includes a cross-language chain test. The Python bridge record is accepted by the real `paper_auto_v1` database, then traded by the controller and the frozen planner against the fake broker.
