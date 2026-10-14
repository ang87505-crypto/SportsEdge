# Identity-bound development replay and QC Free handoff

## Outcome and review boundary

This is an engineering milestone, not a historical backtest. It repairs the
missing prior-mark/new-identity bridge and adds a six-account chronological
replay using the frozen selection, accounting, costs and reporting. No genuine
source observations were admitted. Historical performance remains **not measured**.

The branch is stacked on PR #50 at `7e338aeed26a04c47cd96ee233f97918ceab9b8f`,
which depends on PR #43 at `c9d569891682d8e88972c7b7a09067a7f41bd3bb`.
The `integrations/quantconnect` files from PR #48 at
`876ed7bc39eb136d6ee00467f4865e33d6641537` are reused byte-for-byte, including
the PR #45 selection/diagnostic work at `7677d2e66b49d73bcb9c521a3388f3ea29da4f81`.
The unrelated PR #48 news-event/shadow-research additions are not imported.
These are explicit reused source blobs, not a claim that either PR was merged.

Main observed during inspection: `96a3aada8643371012a4667ec52347a53b1b5dee`
(PR #51 progress hub and charts). This research PR changes no existing files
relative to #50, touches no PR #47 account dashboard, and does not revert main's
new UI. Review #43/#50 and the reused #45/#48 components before integrating this
branch; preserve newer main files when updating the stack. No merge authorized.

## New implementation

- `analytics/stock_identity_bridge_v1.py`: half-open, availability-checked
  historical identity/classification intervals; disjoint ticker reuse; gap,
  overlap, late evidence and issuer-substitution rejection. Every raw price and
  action supplies its permanent ID and historical ticker before relabeling to
  the prior-close ticker used by the frozen selector. Historical first-trade
  evidence is cross-checked; a security-type conversion is not a rename.
- Economically neutral checkpoints admit new members' source-validated prior
  marks, reconcile aliases and retire only ended, unexposed IDs with no prior
  economic action history. Existing prices, cash, holdings, claims, history,
  origin and revision cannot change. Every checkpoint binds before/after hashes.
- `analytics/stock_identity_stream_v1.py`: baseline and hold-rank-ten candidate,
  each at 15bp/$0, 25bp/$1 and 50bp/$1, using the original open-price proxy and
  compounded spread/slippage convention. Each day's six accounts commit only
  after all six reconcile. A failure permanently poisons that stream. No skipped
  sessions or partial performance report; benchmarks and full coverage required
  before a historical result. PR #50 metrics/bootstrap functions are reused.
- `integrations/quantconnect/cloud_identity.py`: in-cloud source interface,
  development-only pre-read gates, hash-bound evidence references and fixed
  external failure status. No network, broker, data export or paid API calls.
- `scripts/package_stock_identity_cloud.py`: deterministic, code-only Python
  upload package, within Free file limits. Bootstrap restores frozen bytes to an
  isolated temporary root and checks source hashes before imports. Existing
  package-name collisions fail instead of loading unrelated code.
- Tests and a Python 3.12/3.13 GitHub workflow produce the code-only upload artifact.

Daily input history is streamed. Monthly full-universe raw evidence is still
materialized and rescored across accounts. This is **not** proof that a full
market fits a Free node's memory/runtime budget; profiling needs authorized
in-cloud source data. No larger node has been purchased or assumed necessary.

## Reproduction

Run from repository root:

```bash
python -m unittest analytics.test_stock_identity_bridge_v1 analytics.test_stock_identity_stream_v1 integrations.quantconnect.test_cloud_identity -v
python -m unittest discover -s analytics -p 'test_*.py'
python -m unittest discover -s integrations/quantconnect -p 'test_*.py'
python research/stock_development_20261014/reproduce.py
python scripts/package_stock_identity_cloud.py --output /tmp/sportsedge-cloud-new
node --experimental-strip-types --test src/lib/*.test.mjs src/lib/ingestion/*.test.mjs src/lib/stocks/*.test.mjs
```

Choose a fresh package output directory; existing files are never overwritten.
All success fixtures are fictional and explicitly synthetic. They do not pass a
historical-source gate or measure strategy performance. The stream tests compare
all six complete statistics dictionaries to PR #50, repeat deterministically,
exercise empty initial identity registries, and independently reconcile cash,
positions, costs and NAV. Adversaries include a sixth-scenario failure (none of
the other five states commits), omitted/repeated sessions, ticker reuse/rename,
late metadata, future bars, incorrect marks, missing members and held delistings.

Initial local checks caught an inconsistent shortened synthetic calendar; the
fixture's model and replay calendars were aligned. The partial local source
checkout also lacked the unchanged Elo JSON fixture; its original Git blob hash
was verified and restored. Neither issue required changing frozen source.

## Run inside the existing SportsEdge-Stock-Research project

The direct browser inspection reached QuantConnect's logged-out terminal.
No cloud project was edited and no cloud backtest ran. Signing in would permit
installation/runtime verification, but would NOT supply the missing source proof.

1. Build the package above or download the code-only GitHub Actions artifact.
2. Add its generated `.py` files to the existing project through the web IDE.
   Preserve the existing diagnostic `main.py` and `research.ipynb`. Count existing
   files first; the Free plan permits 25 files, at most 32 KB each. This package
   reserves room for the notebook, diagnostic and a provider module. If the
   project has unrelated files, use an explicitly reviewed library arrangement;
   do not delete files or purchase an upgrade automatically.
3. In a fresh research notebook kernel, run this source-only installation check:

```python
from se_bootstrap import install
install()
from analytics.stock_readiness_pipeline_v1 import verify_freezes
verify_freezes()
print("SPORTSEDGE_CODE_VERIFIED_NO_HISTORICAL_RUN")
```

4. Only after a reviewed in-cloud provider exists, invoke:

```python
from sportsedge_cloud_entry import run
# reviewed_source is an IN-CLOUD implementation of the interface below.
status, internal_report = run(reviewed_source)
print(status)  # Fixed status only. Keep internal_report inside QC for review.
```

There is intentionally no fake `reviewed_source`, mock market-price generator,
or automatic conversion of QC fundamentals into a claim of full-market coverage.
This is a tested execution/handoff implementation, **not a turnkey QC historical
data provider or a native LEAN cloud execution verification**. The original QC
diagnostic remains available for an initial in-cloud metadata investigation.

### Required in-cloud source interface

`metadata()` returns exactly `phase`, `start`, `end`, `runtime_scope`,
`dataset_revision`, `lean_version`, `protocol_sha256`, `reviews`. Phase is
`development`, dates are `2000-01-01` and `2011-12-31`, scope is
`quantconnect_cloud`. The ten reviews are the unchanged `REVIEWS` inventory in
PR #50; each is `{reviewer, status, reference, sha256}`. Status must be genuinely
reviewed; merely changing a string does not establish coverage. `evidence(ref)`
returns the corresponding bytes **inside QC** for SHA-256 verification.

`header()` returns `{initial, calendar, settlement}` using the unchanged v2
schemas. It is not called until all metadata/evidence gates pass. `rows()` yields
every development exchange session with `{session}` plus `{evidence,
identity_records}` on exactly the first session of each month. Evidence is the
existing full-universe schema, but every raw bar and corporate action carries
`security_id` and its historical `symbol`. All required members remain present,
including known short-history IPOs. Identity rows have the exact `FIELDS` schema
in `stock_identity_bridge_v1.py`; intervals and source references cover the full
signal window and any old alias/retired identity being reconciled. No new listing
date may be inferred from the first downloaded bar.

`benchmarks()` returns `{benchmarks, risk_free}` using PR #50's licensed daily
broad-market-total-return and monthly rebalanced half-market/half-cash paths.
The risk-free series is null or the registered aligned monthly series. Results
remain pending independent review and cannot self-publish to the website.

## Remaining blockers: do not bypass

| Requirement | State after this PR |
|---|---|
| Mapping/identity/new-member mechanics | Implemented and synthetically reconciled; real interval evidence absent |
| Historical classifications and complete PIT universe | Explicitly checked against supplied records; not independently authenticated or proven complete |
| Raw prices, consolidated volume, availability/revisions | Existing gates preserved; no admitted historical provider |
| Splits and ordinary USD dividends | Existing v2 support reused; actual entitlement/payable evidence still required |
| Fractional splits, due bills, combined actions | Still rejected; no guessed cash-in-lieu or timing |
| Delistings, mergers, spinoffs, uncertain recoveries | Still rejected; neither zero nor last-price liquidation substituted |
| Exit with a held security, claim or past economic action | Explicit failure; needs a lifecycle-aware extension/reconciliation |
| Benchmarks, calendars, execution size/price proxy | Require reviewed sources and conventions, not invented displayed liquidity |
| QC installation/engine compatibility/full-market memory | Locally tested package; native cloud run not performed |

Next engineering work needs documented real event examples, inside their licensed
environment: a delisting recovery, cash/stock merger and fractional entitlement
with effective/ex/record/pay dates and share basis. Implement a separately
versioned lifecycle extension against those economics before admitting the full
historical stream. A paid API does not resolve those missing facts.

The smallest owner action for cloud installation verification is secure access to
the existing QC project, or running the code-only installation check above.
No payment is needed for that check. It does not unblock a genuine backtest by
itself; source-provider implementation and independent evidence review remain.

## Official documentation checked 2026-10-14

- https://www.quantconnect.com/docs/v2/cloud-platform/organizations/tier-features
- https://www.quantconnect.com/docs/v2/cloud-platform/projects/files
- https://www.quantconnect.com/docs/v2/research-environment/key-concepts/research-engine
- https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/security-identifiers
- https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/morningstar/us-fundamental-data
- https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/quantconnect/us-equity-security-master
- https://www.quantconnect.com/docs/v2/writing-algorithms/securities/asset-classes/us-equity/corporate-actions
- https://www.quantconnect.com/terms/ (version 1.5, October 8, 2026)

Free supports web-IDE backtesting/research; API access is a paid-tier feature.
QC terms permit internal storage/reuse, prohibit exporting platform data, and
separately allow ordinary strategy summary results under section 2.6(e). This
implementation exports no platform data, including through exceptions. Registry
and source evidence remain in-cloud. Do not download Object Store data or paste
vendor records into this chat. A security master or a Morningstar universe is
not independent proof of the complete registered historical market.
