# Stock accounting and execution v2 — implementation handoff

**Completed offline implementation milestone. No genuine market returns were measured.**

The new baseline adapter and replay share one execution kernel. They derive signals from prior account state, maintain dividend receivables and unsettled sale proceeds, preserve subcent prices, and enforce the same cost and rebalance risk rules. The frozen baseline and hold-rank-ten candidate are unchanged. Candidate execution remains blocked.

## Base and preservation

Exact base: PR #34, `92eaa17a4ba3147d9faa2d39785fabf5f49e9a82`, inheriting PR #30, `d62e509421a0929fe5c4bcf8456eb1dcc3e7a952`. The stock chain remains #16 → #18 → #19 → #27 → #29 → #30 → #34. At the final working-state inspection, #34 was still open at that head; newer #35–#37 concern UI/NBA work and do not duplicate these stock repairs. Root AGENTS.md was inspected: its Next.js-specific instructions do not apply to these standalone Python modules. No nested AGENTS.md appeared in the pinned tree.

Delivery is an **additive patch against that exact commit**, not a replacement for the previous audit. No resulting remote commit is claimed. The work was isolated in a separate local snapshot; no existing source, tests, protocol, candidate, or recorded output was edited. Publication is left to engineering so a remote push cannot trigger a hosting deployment during this no-deploy milestone. PR #15 remains separate. No NBA development, website work, database writes, provider requests, purchases, brokerage access or trades occurred.

New files:

- `analytics/stock_accounting_v2.py`: monetary state, corporate events, settlement, shared opening planner, and separate close bookkeeping.
- `analytics/stock_baseline_replay_v2.py`: authoritative baseline recomputation, planner entry point, complete chronological replay and offline CLI.
- `analytics/test_stock_accounting_v2.py`: adversarial synthetic tests with literal expected accounting outcomes.
- This document.
- `research/stock_accounting_v2_20261012/{protocol_amendment.json,reproduce.py,synthetic_results.json,verification.json}`.

## Entry points and trust boundary

Use `signal_from_account(account, model, calendar)`, `plan_baseline(account, model, opening_session, ...)`, and `replay(initial_account, rows, ...)` from the adapter. `model` accepts exactly `strategy_version`, `payload`, `context`, and `decision_at`. It accepts **no equity override, holding override, target override, or precomputed signal**. The only admitted strategy is the unchanged baseline version. Relabeling a candidate signal cannot execute it: the adapter recomputes the original baseline itself.

The kernel's `plan_open` is a lower-level accounting primitive for already validated permanent-ID budgets, not a separate approved strategy adapter or order-placement interface. `new_account` creates a prior-close snapshot; `close_session` books later marks after planning. These functions are pure and return copies. The opening plan's state is an intermediate projection, not a close checkpoint and not suitable for feeding directly into another day. Use the returned close `state` for the next session.

The supplied initial account and source declarations must be independently authenticated by engineering. Content hashes bind inputs and aid reproduction; they do not establish source truth, authorize a trade, implement database concurrency, or prevent an attacker from fabricating an entire initial snapshot. This is a deterministic offline transition engine, not a broker or persistent account service.

## State and timing contract

- Positions are positive whole economic shares keyed by **permanent security ID**. `symbols` retains the current display ticker. Renames require an explicit same-ID event; identity substitution, ticker collisions, and silently absent holdings fail.
- Account equity is exact USD: settled cash + unsettled sale proceeds + outstanding dividend receivables + current share value. No claim is counted twice. The model receives floor(prior-close NAV × 100), because its unchanged API accepts integer cents; marks themselves remain unrounded.
- Decisions are at **08:00 America/New_York** on the first next exchange session after month end. The prior state must be the latest completed session. All universe members' last model closes must equal the prior ledger marks, with matching IDs and timely availability. Model and replay exchange calendars must agree.
- Every exchange session between checkpoints is required. In baseline replay, every month boundary requires a model decision. A failed date/security is never dropped. `accounting_fixture` mode permits isolated non-strategy lifecycle tests only when every row is explicitly synthetic; the CLI does not expose that bypass.
- The model's economic corporate actions during the replayed portion of its lookback must match the ledger history by security, date, ratio, dividend and source event ID. Pre-origin history remains externally supplied evidence. Historical aliases must be normalized consistently to permanent IDs by the future data adapter; the engine does not invent a ticker history.
- The open planner **rejects a `close_marks` field**. Replay strips those later marks before calling the same planner, then invokes close bookkeeping. Changing future closes does not change the trades or signal. The close phase verifies the opening evidence digest before booking anything.
- Quotes must be raw USD bid/ask, with observation ≤ availability ≤ open and age ≤60 seconds. Missing, crossed, stale, future, untradable or insufficient-size quotes invalidate the session. Later daily-bar publication cannot be silently relabeled as an available opening quote. A separately documented historical proxy adapter is still needed if genuine opening snapshots are unavailable.

## Shared arithmetic, costs, sizing and gaps

Source prices and per-share dividends are Decimal strings with at most six fractional digits, matching the inherited daily-price contract. No float conversion is used. The kernel isolates 60-digit HALF_EVEN arithmetic from the caller's precision, rounding and traps. The original model still performs its original 50-digit calculations. There is no intermediate per-share cent rounding.

For quantity `n`, quoted ask `a`, bid `b`, additional slippage `s` in basis points and integer-cent fee `f`:

- Buy unit price: `a × (1+s/10000)`; debit = ceil(`100 × n × unit`) + `f`.
- Sell unit price: `b × (1−s/10000)`; proceeds = floor(`100 × n × unit`) − `f`.
- Negative net sale proceeds are unsupported and invalidate the study.
- The quote already contains the spread. Unknown cost fields—including a second half-spread setting—are rejected. Receipts separate fee, spread, additional slippage and cash-rounding costs.

**Gap policy is an execution-policy amendment, not a change to the strategy's selection or target budgets.** At the open, compute current economic NAV from midpoint marks after applicable events. For each selected security, cap the frozen budget at 10% of this NAV. Compute an upper bound on quantities, then reserve the possible cost of liquidating the current holdings plus repurchasing those upper-bound quantities. This intentionally conservative reserve gives a lower bound on post-cost NAV. Size each target using the smaller of its frozen budget and 10% of that lower bound, including the fee and adverse buy price. This can undersize by a share; it is not an optimized execution policy. Verify actual post-cost 10%-per-name and 50%-gross limits after all trades.

Sells precede buys, but **their proceeds remain unsettled**. Buy only the largest affordable whole-share quantity using settled cash, in sorted permanent-ID order. Log cash-constrained reductions, including zero-share buys. No automatic intramonth retries occur after settlement. This deterministic cash constraint is not a dropped data failure. Liquidity, availability, unsupported events and inconsistent evidence instead stop the entire run.

Orders must fit displayed size and 1% of the prior 20-session consolidated mean share volume. On model dates, volume is recomputed from the actual model bars, adjusting earlier volumes for subsequent known splits to the prior-close share basis, then conservatively flooring the mean. An opening split converts that limit into current-share units. Nondecision daily volume evidence remains a data-adapter responsibility. The baseline dollar-volume eligibility calculation is unchanged.

Caps apply at rebalance execution, not continuously: market moves can raise concentration afterward. The next-open quantity still depends on the observed opening price. Such a price-contingent opening fill is an **idealized scenario**, not proof of a feasible pre-open market-on-open order or guaranteed execution. Actual bid/ask timestamps and displayed size alone do not establish fills, latency or queue priority.

## Dividend and corporate-event lifecycle

For a supported ordinary cash dividend, freeze entitlement using the economic shares held immediately before the ex-date opening trades. Create a receivable equal to `entitled_shares × per_old_share`. It enters NAV immediately, but it is not spendable cash. A sale afterward changes the position without deleting that claim; an ex-date buyer receives no claim for the newly purchased shares.

At the explicit supplied `pay_at` cash-credit timestamp, credit the account's aggregate event entitlement rounded HALF_UP to cents once; log the rounding difference and remove the receivable. If that time falls after the open, it cannot fund that opening rebalance. The close checkpoint can book an intraday credit, making it available to later sessions. Weekend/overnight credits are processed at the next checkpoint. There is no automatic dividend reinvestment, tax withholding or interest. The signal's total-return index convention remains unchanged and separate.

`pay_at` is an explicit scenario cash-credit assumption, **not a timestamp inferred from a provider's payment date**. Verify actual cash availability or register conservative timing before genuine evaluation. The engine assumes the declared ordinary dividend pays; cancelled, revised, disputed or delayed payments need their own reconciled lifecycle and invalidate unsupported scenarios.

Supported events:

| Event | Required behavior |
|---|---|
| Ordinary USD cash dividend | Explicit ex-date open, timely evidence, no due bills, amount below 25% of prior closing price, explicit cash-credit timestamp. |
| Split/reverse split | Effective at open; positive integer numerator/denominator ≤1000; resulting owned shares must be integral. Prior earned dividend claims stay fixed. |
| Rename | Explicit old ticker → new ticker under the same permanent ID; no collision or ID reassignment. |
| Duplicate source ID | Reject across the full account history, including events on securities not held. |
| Multiple events for one security at the same open | Reject until event ordering and combined entitlements are explicitly supported. |
| Delisting, merger, spinoff, stock distribution, special/due-bill dividend, fractional entitlement/cash-in-lieu | Reject the entire study. No invented recovery, zero payout, forward fill or disappearing position. |

Incomplete corporate-action coverage is rejected. A caller setting `actions_complete=true` still does not prove completeness; source-level verification remains necessary.

## Settlement policy and primary documentation

The versioned internal policy is a **conservative settled-funds-only cash account**. Purchases reserve/pay their cash immediately and create economic positions on trade date. They do not produce a second purchase debit at settlement. Sales reduce economic shares immediately and create a cash claim due on the regular-way settlement date. This models fully paid economic ownership, not a broker's custody/delivery subledger, settlement failure or regulatory compliance certification.

The policy uses the trade date's historical regime: T+3 for the supported 2000–2017-09-04 period; T+2 from 2017-09-05; T+1 from 2024-05-28. It requires a separate, complete, revisioned settlement-business calendar extending past the final trade. It does not treat every trading day as a settlement business day. Proceeds become spendable at the first processed checkpoint on/after the due date, under the explicitly frozen regular-way assumption.

Primary sources checked for this milestone:

- SEC, T+1 FAQ: https://www.sec.gov/exams/educationhelpguidesfaqs/t1-faq — compliance date May 28, 2024; regular-way scope and exceptions.
- SEC, T+2 implementation: https://www.sec.gov/newsroom/press-releases/2017-163 — September 5, 2017 transition from T+3 to T+2.
- SEC Investor.gov, dividend entitlement: https://www.investor.gov/introduction-investing/investing-basics/glossary/ex-dividend-dates-when-are-you-entitled-stock-and — ex-date separates ordinary buyer/seller entitlement; distributions of 25% or more and stock distributions have different rules. The engine requires supplied ex-dates rather than deriving them from record dates.
- FINRA, frequent trading in cash accounts: https://syndication.finra.org/content/frequent-intraday-trading-understanding-basics — fully paid securities, unsettled proceeds and good-faith/freeriding concerns. The engine's settled-only rule is deliberately stricter than a general description of what a broker may permit.
- DTCC, holiday processing: https://www.dtcc.com/-/media/Files/Downloads/Institutional-Trade-Processing/TradeSuite-ID/Holiday-Processing-B1P3.pdf — supports treating settlement availability separately from an exchange trading calendar. No real calendar was downloaded or substituted with weekdays for a return study.

## Verification and independently calculated cases

**220 tests pass: 180 inherited Python tests plus 40 new v2 tests.** All new fixtures are synthetic. Prior suites include other existing repository modules; passing them does not constitute new NBA research. The separate frozen PR #15 ledger was not wired into or modified by this work.

Selected exact checks:

| Synthetic case | Independently expected result |
|---|---|
| Buy 3 shares per name at ask 30.01, 10-bp extra slippage, 25-cent fee | Each debit: `ceil(3 × 30.01 × 1.001 × 100)+25 = 9,038` cents. Two names leave 81,924 cents settled cash. Total opening cost is $0.76. |
| Existing 10 AAA shares, 54,800 cents cash; bid 29.99/ask 30.01 | Sell 8 AAA for 23,943 cents unsettled; buy 2 BBB for 6,034 cents; settled cash 48,766; post-cost opening NAV $847.09. |
| Buy 9 shares at 10.000001, no fee/slippage | Order debit 9,001 cents, not 9,000. Source precision is retained until aggregate cash rounding. |
| Own 10 shares before $1 ex-dividend, then sell all | $10 receivable survives sale, pays only at credit time, and is not attributed to new buyers. |
| Three shares × $0.005 dividend | $0.015 receivable before payment; 2 cents paid at HALF_UP rounding, with $0.005 rounding difference recorded. |
| 2-for-1 split of two owned shares at price halved | Four shares, unchanged economic NAV; explicit later ticker rename preserves permanent identity. |
| Prior regular-way trade on 2024-05-24 vs 2024-05-28 | T+2 and T+1 respectively, both due May 29 under the synthetic holiday calendar fixture. |

Tests also cover both gap directions, post-cost cap boundaries, positive/negative cash effects, partial/zero buys, settlement without same-day sale reuse, payment before versus after open, sales before ex-date, reverse splits, split-normalized volume, next-month state and action reconciliation, stale/missing/future information, missing monthly decisions and dates, missing closing marks, unsupported events, duplicate events, identity substitution, deterministic Decimal behavior and input preservation. Planner/replay trade receipts match. The CLI refuses overwriting successful results and writes no partial output after a failure.

Development failures are recorded candidly: an initial test-file command used the wrong working-directory prefix, causing a module-import failure before tests existed. Later, the new next-month fixture initially retained an October 2 retrieval timestamp while containing later October bars; the inherited chronology validation correctly rejected it. The fixture was corrected to a November retrieval timestamp. No production validation was relaxed. No unresolved test failures remain. Final runs and hashes are recorded in `verification.json`.

## Resolved and unresolved audit findings

| Finding | Status in this milestone | Remaining boundary |
|---|---|---|
| Equity/holdings disconnected from ledger | Resolved in v2 adapter | Initial snapshot must come from trusted records; persistence/revision locking is engineering work. |
| Model/ledger price, calendar and identity disagreement | Resolved consistency checks | Source authenticity, complete calendars and PIT ID history remain unverified. |
| Subcent source-price mismatch | Resolved in v2 | Six-decimal supported bound; reject greater precision pending a reviewed contract. |
| Different planner/replay cost and cap rules | Resolved by one shared kernel | Original v1 modules intentionally retain frozen behavior; do not mix v1 and v2 state/receipts. |
| Adverse gap aborts from stale budgets | Resolved with deterministic current-NAV sizing | Illiquidity, negative proceeds or exhausted NAV still invalidate; never skip them. |
| Cash dividend credited to wrong holder/time | Resolved for supported ordinary dividends | Payment timestamps, revisions/cancellations, taxes, due bills and special events require verified data or further handling. |
| Unsettled sale proceeds reused immediately | Resolved settled/unsettled separation | Actual failed/delayed settlement and custody delivery are unsupported. |
| Split/rename handling | Supported with permanent IDs and whole shares | Combined events, fractional entitlements, mergers and delistings remain blocking. |
| Candidate could bypass baseline version | Blocked by recomputation-only adapter | Separate candidate adapter and review still required. |
| Incomplete source archiving, PIT universe, IPO/history limit | Unchanged and unresolved | Preserve original bytes, verify action coverage, normalize aliases, support complete universe and known-age IPO exclusion. |
| Executable historical returns | Not established | Quotes/fills or explicit proxy adapter, licensed data, event completeness, costs, benchmark and untouched test gates still required. |

## Protocol amendment and next engineering steps

`protocol_amendment.json` records these execution conventions **before any genuine returns were inspected** and hashes the untouched original protocol. Strategy parameters, candidate count, chronological partitions, benchmarks and statistical decision rules remain frozen. Engineering must review the execution amendment before historical use. Apply identical accounting and execution rules to baseline and candidate once a separately reviewed candidate adapter exists.

1. Apply the additive patch on an isolated branch based on the exact #34 head. Run the full suite and reproduce the synthetic output. Do not route existing v1 paper accounts into v2 or migrate #15 implicitly.
2. Use the v2 baseline adapter as the single stock-research entry point; preserve its account digest, revision, exact evidence, event IDs and resulting close state. It provides no owner authorization, broker calls or database write path; do not expose the kernel as an order endpoint.
3. Next milestone: validate a **small legally obtained** source sample with a dividend, split, rename and delisting. Required inputs are original source bytes/revisions, raw exact prices and consolidated volumes, dated permanent-ID mappings/universe/sectors, information-availability semantics, independently audited exchange/settlement calendars, ex/effective/credit dates and complete event terms. No paid request or account access is authorized here.
4. The delisting in that sample must currently produce an explicit unsupported-event failure. Reconcile actual consideration and implement its tested lifecycle before running any complete sample/study that needs it. Do not remove that company to make the sample pass.
5. Resolve full-universe/IPO and source-provenance gates, historical execution assumptions, and required event types before a return evaluation. Add the reviewed candidate adapter afterward, then follow the registered development/validation/sealed-test protocol and total-return benchmarks. Any necessary date, cost, event or execution-policy amendment must be recorded **before inspecting returns**.

## Reproduction

From the pinned repository checkout with this patch applied (Python 3.12, standard library only):

```bash
python -m unittest analytics.test_stock_accounting_v2 -v
python -m unittest discover -s analytics -p 'test_*.py' -q
python research/stock_accounting_v2_20261012/reproduce.py --output /path/to/NEW-synthetic-results.json
```

To replay an independently supplied reviewed envelope:

```bash
python -m analytics.stock_baseline_replay_v2 --input /path/to/evidence.json --output /path/to/NEW-result.json
```

The envelope has exactly `initial_account`, `rows`, `calendar`, `settlement`, `costs`; each row contains `session` and, at month boundaries, `model`. The synthetic fixture generator demonstrates the complete schema. The reproducibility runner and CLI both refuse existing output paths. They contain no provider network call and do not place trades.
