# Forward learning and penny paper study — 2026-11-19

This implementation completes the study machinery behind the penny preview and the nine-variant sports lab. It is additive and uses stored props data only. Production model selection, existing $5 paper entries, paid odds budgets and stock/broker execution settings are unchanged.

## Activation and database boundary

Apply `database/props/forward_studies_setup.sql` to the **active props ledger project**, then run the `Forward paper studies` workflow. The setup file is generated reproducibly from `props_lab_v1.sql` and `props_penny_paper_v1.sql` by `scripts/build-forward-study-setup.ts`. It creates missing complete schemas atomically, refuses a wrong or partial database, preserves existing rows and definitions, and reapplies restricted grants when repeated. It requests a PostgREST schema-cache refresh.

The connected Supabase account inspected in this session lists the older SportsEdge project `fzyjazhvkstvwwzjhlrr` and a paused staging project. The older project has no `props_*` relations. A read-only query against the other runtime-allowlisted project, `vfyzbliksooljxrlfadp`, was refused with “You do not have permission to perform this action.” Do not apply the bundle to the older database. `forward-paper-studies.ts` prints the configured database host, without any key, before checking the actual study tables. This document does not claim that the inaccessible live database has been migrated.

No API key, password, connection secret or new paid account is needed in the SQL file. Use the existing owner-authorized database account. Access denial is a configuration boundary, not evidence that the original paper collector stopped working.

## Forward lab operation

The separate serialized workflow runs after a successful capture tick or paper cycle, plus a daily backup. Its first action verifies every required lab and penny table. Missing/inaccessible tables produce an explicit blocked status and nonzero exit, not an OK study run. The original collection and settlement jobs continue separately.

After readiness, the runner freezes the nine registered variants, penny entries and existing shadow-staking methods, then performs grading and reporting. It makes no odds-provider, broker or model API request. The capture tick's old duplicate lab step is removed; the new workflow handles both captures and settlements, so reporting no longer depends on a tick happening during one particular UTC hour.

Interrupted freezes resume missing variants and flags while preserving predictions already frozen. The existing registration must match both the spec and artifact hashes. The original shadow trainer, promotion requirements and rejected-experiment history remain authoritative.

## Separate penny cohort

`penny-paper-entry-v1` has two independent virtual accounts, each starting at $500:

| Arm | Stake rule |
|---|---|
| Probability-sized | One cent per complete percentage point above whole-entry break-even, up to $0.50 |
| Reference | Flat $0.10 on the same eligible source entries |

Both arms have independent $15 daily exposure limits and available-funds checks. Existing paper accounts and stakes are never changed. The cohort begins at database registration time; it does not backfill or rewrite old entry decisions. Each new eligible source entry is mirrored once, before its first lock and before any source result exists.

This first version supports two-pick PrizePicks Power entries with the existing recorded `prizepicks-power-standard-20261107` terms: 3× gross when both picks win. It excludes unknown terms, Pick6 payouts, same-game dependence and repeated player identities. The snapshot includes original prediction IDs, model versions, probabilities, availability times and pick IDs.

The estimated chance of both legs winning is the product of their recorded **unconditional side probabilities**, rounded down to integer millionths, with a fixed 2% relative haircut for residual dependence. This is an uncalibrated model-estimate experiment. The haircut is an assumption, not an empirically validated correlation model. A higher stated estimate can still be less accurate. No probability, performance or profitability improvement is claimed.

For example, two recorded 65% side probabilities produce an estimated whole-entry probability of 41.405% after the haircut. Against the recorded 3× payout, the variable stake is eight cents. Two 75% sides produce 55.125% and a 21-cent stake. These are illustrative policy calculations, not reported predictions or odds from a real event.

## Integrity, grading and corrections

The database computes the probabilities, sizing inputs and both stakes itself; caller-provided money and timestamps are replaced. An advisory transaction lock serializes reservation and settlement for the cohort. Record time is sampled **after** acquiring the lock, so waiting cannot create a falsely pre-lock stake. Immutable rows and content hashes preserve the original decisions; a tampering view detects out-of-band changes.

Settlement requires the latest available grade for each frozen source leg. The database checks the exact grade IDs and computes both returns. A losing leg returns zero; both wins return 3×; two voids refund the stake; one win plus one void returns 1.5× under the captured two-pick rule. This virtual experiment explicitly floors fractional-cent returns: a one-cent stake at 1.5× returns one cent. This rounding is an experimental accounting rule and is not described as an external provider's policy.

A correction appends a new settlement revision referencing the new source grades. Previously recorded grades and stakes remain immutable. Reporting uses only revisions available by the report time and the latest such revision. It shows separate available funds, open reservations, realized profits, exposure and recent frozen stakes for both arms. Unknown returns stay unknown. Results are descriptive; the study cannot promote a model or claim that a staking method is superior.

New tables have RLS enabled, public/authenticated access revoked and service-role SELECT/INSERT only. Functions run as the invoking role with a fixed search path. No privileged key reaches a browser component.

## Verification

The local suite passes 959 JavaScript tests (1,006 discovered; 47 database-dependent tests skipped in that runner). TypeScript, production build and lint pass; lint retains the six existing warnings. Native disposable PostgreSQL 16.2 tests verify the base migrations, first installation of the exact owner bundle, repeat installation, all existing lab contracts and the new penny contracts. CI also runs the contracts against its disposable PostgreSQL and verifies the exact published head.

New tests cover hand-calculated stake/return values, monotonicity, odd-cent rounding, ignored forged amounts and timestamps, no pre-cohort backfill, duplicate refusal, after-lock refusal, pause behavior, per-entry/daily caps, actual grading, appended corrections, immutable rows, public access denial and tampering detection. A separate setup test deliberately enables broad legacy default grants and verifies that neither public access nor service-role UPDATE/DELETE/TRUNCATE survives. Worker tests cover missing schemas, policy conflicts, future-grade exclusion, repeated grade sets and source-only writes. A resumed lab freeze is tested independently.

Deployment alone does not prove activation. Completion requires a READY schema check on the active database, a successful worker run, a real cohort registration, and subsequent frozen/graded records from eligible future events. Zero eligible entries is valid; it must not be replaced with synthetic history.
