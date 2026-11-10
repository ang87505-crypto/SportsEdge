# Forward-only virtual tracking for `mq-buffer-v1`: design, readiness and audit (2026-11-10)

**Owner approval (2026-11-10):** prepare forward-only virtual tracking of `mq-buffer-v1` from the 2026-11-30
month-end signal.
- **Prepared and tested, NOT scheduled.** Nothing places an Alpaca order, activates a strategy, or changes a
  production setting, risk control, owner gate or release pin.
- **PR #133 stays unmerged.** This work is stacked on it.

## 1. What the ledger records, and when

**Where it lives:** a separate append-only branch, `research-forward-ledger`, written by
`.github/scripts/forward-ledger-branch.sh`.
- Existing files may never change or disappear.
- `chain.jsonl` and `events.jsonl` may only grow.
- **Git commit dates are not evidence.** The client writes them and they can be backdated. Timing rests only on
  the server-side receipt (section 1a).

| Record | When | Contents |
|---|---|---|
| `predictions/<signal>.json` | Once, after a month-end session's close (data at least 10 minutes past the close, requested 20 minutes behind real time) and **before the next session's open** | The full record (below), committed immediately by the same job |
| `chain.jsonl` | With each prediction | Signal, record SHA-256 and previous record SHA-256 (hash chain) |
| `missed/<signal>.json` | The first run after a month-end's next open with no prediction | `MISSED`, `reconstructed: false`. Permanent |
| Server receipt (on GitHub, not in the branch) | Immediately after the prediction is pushed | A GitHub commit status on the commit that added the file (section 1a) |
| `receipts/<signal>.json` | After the receipt is read back | A cache of the server evidence. **Verification never trusts it** and always re-reads GitHub |
| `events.jsonl` | Every run | `NOT_A_SIGNAL_SESSION`, `BEFORE_CLOSE_DATA`, `DATA_NOT_READY` (with the missing members), `TOO_CLOSE_TO_DEADLINE`, `RECEIPT_CHECK_UNAVAILABLE`, `RECORDED`, `DUPLICATE_RUN` (and `RECOMPUTE_DIFFERS` when today's data would give another answer), `MISSED` |
| `outcomes/<run>.json` | Every evaluation | Results from frozen predictions and current market data; input revisions flagged, never applied |

**Each prediction record holds:**
- the decision time (signal close), the next open (the deadline), the execution session and the creation time;
- the data request end time;
- the input fingerprint;
- members missing a signal bar;
- the code commit and the pre-registration;
- for `mq-buffer-v1`: its targets, the names held before and kept by the buffer, and the ranked top 20;
- for the unchanged baseline `momentum-quality-paper-v1`: its targets;
- for both, the targets a $1,000 account cannot hold as one whole share, with their prices.

**Input fingerprint.** SHA-256 over 260 sessions of:
- raw open, close and volume, exactly;
- adjusted daily returns rounded to 8 decimal places.

A dividend after the signal rescales an adjusted history uniformly, so it does not change the fingerprint. Any
revised raw bar or adjusted return does.

## 1a. Server-side timing receipt (`analytics/research/ledger_receipts.py`)

**What it is.** After the prediction commit is pushed, the workflow token creates a GitHub **commit status** on that
commit:
- **context:** `forward-ledger/receipt/<signal>`;
- **description:** `record_sha=<the 64-hex record hash>`.

**Why it is evidence:**
- **Timestamp:** GitHub's server assigns `created_at`. A client cannot set or backdate it.
- **Immutable:** a status cannot be edited or deleted. A later status only adds a newer entry, and the earliest
  matching one is used.
- **Proves existence:** a status can only be created for a commit already on GitHub, so it shows that commit and the
  exact file existed by `created_at`.

**Verification** re-reads GitHub every time and requires all of:
- creator `github-actions[bot]`;
- the right context;
- the exact record hash in the description;
- the file **as it was at that commit** hashing to the same record;
- `created_at` strictly before the next open.

**Fail closed:**
- **Missing or untrusted:** no status, or a status from someone else or for another hash, is not a receipt.
- **Unreachable GitHub:** UNAVAILABLE, which is never VALID.
- **Unchanged rule:** a prediction counts only with a receipt.

**Rehearsal on real infrastructure** (run [42877353969](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42877353969),
separate branch `research-forward-ledger-rehearsal`):
- **Receipt:** status `58557415694`, context `forward-ledger/receipt/2026-10-30`,
  `record_sha=d48af059…1511`, creator `github-actions[bot]`, server `created_at` 2026-11-10T18:39:49Z.
- **Timing:** **37 seconds after the job started**, including 17 seconds of unit tests.
- **Binding:** the file at commit `4a39e04` hashes to the same record.
- **Expected rejection:** verification returned `INVALID_RECEIPT_LATE`, because that rehearsal record's deadline
  (2026-11-02 open) had long passed. That is the correct fail-closed result.
- **Side effect:** Vercel also tried to build the ledger branch and posted failed-deployment statuses. They are
  harmless and ignored by context and creator. Excluding ledger branches in `vercel.json` would be a production
  setting, left to you.

## 2. Status of each month-end

| Status | Meaning |
|---|---|
| `VALID` | Record present, hash and chain intact, created before the next open, a **server receipt** binding this exact record dated before the next open, and buffer holdings equal to the previous VALID prediction's targets |
| `MISSED` | No record before the next open. The portfolio keeps its previous targets. **Never reconstructed from later data** |
| `INVALID_AFTER_OPEN` | The record's own creation time is at or after the open |
| `INVALID_NO_RECEIPT` | No trusted server receipt for this exact record (never pushed, never receipted, or only untrusted or other-hash statuses) |
| `INVALID_RECEIPT_UNVERIFIABLE` | GitHub could not be queried. Fail closed: not counted until a later evaluation verifies it |
| `INVALID_RECEIPT_MISMATCH` | The file at the receipted commit does not hash to the record |
| `INVALID_RECEIPT_LATE` | The server receipt is at or after the open, whatever the git commit date says |
| `INVALID_HELD_STATE_MISMATCH` | The recorded buffer holdings are not the previous VALID prediction's targets, for example because an earlier prediction turned out invalid |
| `INVALID_HASH_MISMATCH`, `INVALID_NOT_IN_CHAIN`, `INVALID_CHAIN_ORDER`, `INVALID_SIGNAL_MISMATCH` | The file was altered, or the chain was broken |

**Previous holdings.** The buffer's retained holdings at prediction time come from the latest prediction that
passes this same verification, receipts included. If an earlier receipt cannot be checked, no prediction is made
(`RECEIPT_CHECK_UNAVAILABLE`); a later attempt retries.

**Outcomes.** Each evaluation uses `VALID` predictions only; invalid ones contribute nothing to performance. At
10 and 25 bps, and at $30,000 and $1,000, it reports these tracks side by side:
- `mq-buffer-v1` continuous;
- `mq-buffer-v1` with the existing 10% halt (no restart);
- the unchanged baseline, continuous and with the halt;
- SPY buy-and-hold.

**Shown for the $1,000 account:**
- unfilled orders (price gap, cash);
- whole-share targets that cannot be bought (`zero_share_targets`, with examples);
- average exposure.

**Review threshold:** `INSUFFICIENT FORWARD SAMPLE` until at least 252 sessions and 12 rebalances.

## 3. Tests

`analytics/research/test_forward_ledger.py` (16 tests) and `analytics/research/test_ledger_receipts.py` (15 tests).
All analytics tests pass.

| Requirement | Tests |
|---|---|
| Month-end detection | Weekday month-ends, a holiday next day (31 Dec 2026), a weekend month-end (29 Jan 2027), Thanksgiving, EST/EDT opens; a too-short calendar fails |
| Late data | Before the close: `BEFORE_CLOSE_DATA`. Missing signal bars: `DATA_NOT_READY` with the names, no record. A later run with complete data before the open records normally |
| Missed scheduling | A run after the next open marks `MISSED` and creates nothing; later runs never fill it; the next month records normally; statuses show `MISSED`, then `VALID` |
| Duplicate runs | A second run changes nothing (`DUPLICATE_RUN`). With revised data: `RECOMPUTE_DIFFERS` is logged and the file is byte-identical. Create-once files |
| Frozen predictions | Evaluation uses the recorded targets even when today's data differ |
| Revised prices | A revised raw bar changes the fingerprint and is flagged `INPUT_DATA_REVISED`; a uniform dividend rescale does not |
| Integrity | An edited record is `INVALID_HASH_MISMATCH`; created after the open is `INVALID_AFTER_OPEN`; the hash chain links records |
| Backdated git timestamps | A real git repo with a commit dated before the open: no receipt gives `INVALID_NO_RECEIPT`; a late server receipt gives `INVALID_RECEIPT_LATE`; an absurd future git date with an in-time receipt is `VALID`. Git dates are irrelevant |
| Missing or unverifiable receipts | No evidence (None or {}) gives `INVALID_NO_RECEIPT`; unpushed gives `NO_LEDGER_COMMIT`; an unreachable server gives `INVALID_RECEIPT_UNVERIFIABLE`; untrusted creator or wrong hash is not a receipt; a later duplicate cannot replace the first; a file changed at the receipted commit gives `INVALID_RECEIPT_MISMATCH`; the API client fails closed on 401/404/500 and network errors |
| Late uploads | Receipted at the open gives `INVALID_RECEIPT_LATE`; no prediction starts within 20 minutes of the open (`TOO_CLOSE_TO_DEADLINE`); a declared `MISSED` month is never recorded later, even with a wrong runner clock |
| Invalid prior predictions | A late-receipted November never sets December's holdings; removing November's receipt makes December `INVALID_HELD_STATE_MISMATCH`; prediction waits when an earlier receipt cannot be checked; invalid months never enter forward performance |
| Delayed runs | For EST, EDT, holiday and weekend month-ends, every proposed attempt lies inside the window, and the first can absorb more than the longest observed GitHub delay (634 min) while still receipting before the open |
| Buffer state | The held list comes from the last `VALID` prediction only |
| $1,000 | An unbuyable whole share is counted and listed (engine `zero_share_targets`); predictions list the names a $1,000 account cannot hold |
| Audit helpers | Cost decomposition adds up; the zero-cost fixed path equals the original; engine settings are restored |

## 4. Real-data readiness run

Actions runs:
- [42872326374](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42872326374): first dry run, no-op
  predict and evaluate, audit;
- [42873224730](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42873224730): audit with the fixed-path
  estimate;
- [42873865782](https://github.com/ang87505-crypto/SportsEdge/actions/runs/42873865782): dry run on the final code.

- **Dry run on the 2026-10-30 month-end, as if 40 minutes after its close (scratch folder and artifact only, label
  `DRY_RUN`):**
  - **Result:** `RECORDED`, deadline `2026-11-02T14:30:00Z`, input fingerprint `ff808ae5…`.
  - **Members missing a signal bar:** 0.
  - **Targets:** buffer and baseline both ADI, AMAT, FCX, MPC, NUE. They match because nothing was held before.
  - **Reproducible:** the final-code rerun produced the same input fingerprint.
  - **$1,000 account:** **4 of the 5 targets cannot be bought** as one whole share: ADI $417.11, AMAT $390.09,
    MPC $444.73 and NUE $273.87 against a $200 slot. Only FCX fits. A $1,000 version of this strategy would be
    mostly cash. The record states this rather than hiding it.
  - **What it does not test:** the bars come from today's archive, so it rehearses the data path and the record,
    not real-time timing.
- **No-op predict on the real ledger:** `NOT_A_SIGNAL_SESSION` (2026-11-10). This created the ledger branch.
- **Evaluate:** `NOT STARTED`, with no month-end yet.

## 5. Audit of the historical `mq-buffer-v1` result (post-hoc diagnostics; the pre-registered verdict is unchanged)

Source: `research-data` `results/buffer-audit-2026-11-10T181514Z.json`, dataset `5143ba7830eae5cf` (the same data as
the PR #133 run).

**Data errors: none found.**

| Check (10 bps) | Buffer | Baseline |
|---|---|---|
| Raw vs adjusted price mismatches above 2% on held names | 0 | 0 |
| Stale marks, missing exit bars, unavailable targets | 0, 0, 0 | 0, 0, 0 |
| Unresolved positions | none | none |
| Fills not at that session's raw open | 0 | 0 |
| Corporate-action records in the window on names the strategy traded (applied while held) | 2,940 (92 names traded) | 3,277 (101 names traded) |

Known residuals:
- **Survivorship:** the current-member universe is survivorship-biased. That is a design bias, not a data error.
- **Data vintage:** a vintage change in Alpaca's AEP history moved two 2019 baseline decisions between data pulls
  (see PR #133).

**Benchmark mismatches: none that flatter the buffer.**
- **Corrected matched benchmark:** exposure-matched SPY (original vs corrected) is 14.00% vs 14.01% CAGR, so the
  correction is immaterial.
- **SPY replayed through the same engine:** at 99% (raw prices, dividends to cash, no reinvestment) SPY earns 13.55%,
  vs 14.47% for the adjusted buy-and-hold used as the benchmark. The benchmark is therefore the **stricter**
  comparison.

**Execution assumptions (10 bps).** The buffer beats the baseline under every assumption, but beats SPY only
narrowly and not under all of them.

| Assumption | Buffer CAGR / Sharpe | Baseline CAGR / Sharpe | SPY Sharpe (same window) | Buffer > SPY | Buffer > baseline |
|---|---|---|---|---|---|
| As tested | 20.5% / 0.859 | 16.7% / 0.744 | 0.844 | yes | yes |
| Execute one session later | 19.5% / 0.835 | 14.0% / 0.651 | 0.844 | **no** | yes |
| Fill at the execution day's close | 19.2% / 0.846 | 12.2% / 0.634 | 0.844 | yes (by 0.002) | yes |
| Limit 1% above prior close | 19.4% / 0.858 | 15.4% / 0.748 | 0.844 | yes | yes |
| No limit price | 20.2% / 0.852 | 17.3% / 0.762 | 0.844 | yes | yes |
| No rebalance band | 19.9% / 0.844 | 17.1% / 0.757 | 0.844 | **no (tie)** | yes |
| 40% rebalance band | 20.6% / 0.861 | 16.9% / 0.748 | 0.844 | yes | yes |
| Start one month later | 20.2% / 0.849 | 16.2% / 0.728 | 0.823 | yes | yes |
| Start two months later | 19.9% / 0.837 | 16.9% / 0.749 | 0.831 | yes | yes |

**Why the buffer looked almost cost-insensitive (requirement 6).** At 0, 5 and 10 bps its CAGR was 20.52%, 20.49%
and 20.47%, although 10 bps cost it $6,270 in fees. The cause is **path dependence, not a cost advantage**.
- **How the paths diverge:** each cost level changes equity slightly. That changes whole-share sizing and whether a
  holding's drift crosses the 20% rebalance band, so different cost levels make a few different trades.
- **The 0-bps path** trimmed 3 TSLA shares on 2020-08-03 (at $1,449, before TSLA's late-2020 rise) and 15 MU shares
  on 2026-05-01. The 10-bps path kept them and bought MPC on 2018-07-02 and 2026-06-01. 236 trades differ in size.
- **Decomposition of the 0→10 bps gap:**

  | Component | Amount |
  |---|---|
  | Cost drag on the 0-bps trade path | $12,239 |
  | Path effect | −$11,504 (the 10-bps path happened to make money) |
  | Net gap | $734 |

- **The baseline** shows the expected linear decline (path effect +$1.8k), so the anomaly is specific to the
  buffer's path.
- **Fixed-path estimate:** the 0-bps trades with costs charged.

  | Cost | Buffer as tested | Buffer, fixed path | Baseline, fixed path | SPY |
  |---|---|---|---|---|
  | 5 bps | 20.5% / 0.860 | 20.1% / 0.850 | 17.4% / 0.772 | 0.844 |
  | **10 bps** | 20.5% / **0.859** | 19.7% / **0.836** | 16.9% / 0.753 | 0.844 |
  | 25 bps | 19.2% / 0.817 | 18.5% / 0.796 | 15.2% / 0.694 | 0.844 |

**Conclusion of the audit:**
- **Not driven by errors:** the buffer's historical result is not driven by data errors or benchmark mismatches.
- **Robust against the baseline:** its advantage over the unchanged baseline survives every execution variation
  tested (+0.08 to +0.21 Sharpe). That is the effect the forward ledger should check.
- **Not robust against SPY:** its narrow pass of the "Sharpe above SPY" gate does **not** survive. On a cost-neutral
  path at the judged 10 bps it is 0.836 vs SPY 0.844, and it also fails with one-session-later execution and with
  no rebalance band. The pre-registered verdict is not rewritten, but it should be read as **"SPY-like risk-adjusted
  return, better than the baseline"**, not as beating SPY.

## 6. What is ready, and what is not

**Ready (tested, on this branch):**
- prediction, outcome and audit code;
- the separate append-only ledger branch and its guard;
- a manual workflow (`research-forward-buffer.yml`), unscheduled, with server-side receipts and step time limits;
- a server-receipt rehearsal on real GitHub infrastructure (section 1a);
- the real-data dry run;
- the no-op ledger run.

**Delayed and dropped GitHub runs (requirement 5).**

| Measurement | Value |
|---|---|
| Record → push → server receipt, real run | 37 s from job start (including 17 s of unit tests) |
| Step time limits (tests, predict, push, receipt) | 5 + 10 + 2 + 3 = 20 min (`PIPELINE_ALLOWANCE`) |
| No prediction starts later than | 20 min before the open (`RECEIPT_MARGIN`); a receipt therefore cannot land after the open unless a step overruns its limit, and then it is `INVALID_RECEIPT_LATE` (fail closed) |
| Window per month-end | Close + 30 min to open − 40 min: about 16 h on weekdays, more over weekends |
| First proposed attempt's tolerable start delay | 970 min (weekday EST), 3,790 min (Friday EDT), 3,850 min (Friday EST) |
| Longest GitHub scheduled-run delay seen in this repo | 634 min (props, 2026-11-09) |
| GitHub scheduled runs **dropped** here, last 7 days | stock worker about 25 of 40, props about 15 of 28, ops monitor about 41 of 42, release watcher about 159 of 168 |

- **Conclusion:** **delays** are covered by a wide margin, but **dropped runs are not**. On this repository GitHub
  skips most scheduled runs.
- **What a GitHub-only schedule risks:** it could easily miss a month. That month would be recorded `MISSED`
  (honest, never reconstructed), not silently filled in.
- **Recommendation before enabling tracking:** trigger `predict` from Vercel crons as well. They ran reliably in this
  repository (stock kickoff, props backups). That is a production scheduler change (`vercel.json` plus a
  `scheduler-kickoff` slot), so it needs your approval.

**Not done (each needs your approval):**
1. **Merging.** PR #133 and this PR stay unmerged. A schedule on `main` needs both merged.
2. **A schedule.** Proposed, not enabled:
   - **Predict** runs **daily** at 21:40, 23:40, 03:40, 07:40 and 11:40 UTC (daily, so Friday month-ends have weekend
     attempts). Duplicates are harmless.
   - **Vercel backups:** strongly recommended, given the drop rates above.
   - **Evaluate** runs nightly at 03:10 UTC.
   - **Deadline:** to catch the first signal, the schedule must be live before **2026-11-30 21:40 UTC**. Otherwise
     November is `MISSED`, never reconstructed, and tracking starts with December.
3. **Insider tie-break forward tracking:** stays blocked (quarterly SEC data arrive too late).
