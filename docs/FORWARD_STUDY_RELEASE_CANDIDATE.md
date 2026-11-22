# Forward paper studies: single release candidate

This candidate packages the completed forward-study chain for one review and one eventual owner-approved main release. It includes #200, #202, #206 and #207 through their existing ancestry; their reviewed branches are unchanged. It does not include the separate archive-publication repair #203–#205, which retains its own deadline and approval.

## Source and changes

| Source | Pinned head | Included work |
| --- | --- | --- |
| #200 | 42fe0bcaec5d06f049f0943914a8cd99cca4aad4 | Exact-baseline monotone shadow, frozen paper studies, SEC intake and stock evidence |
| #202 | 54311297cdf850c661c01523bbb3d209712c3975 | Corporate-action archive verification and redacted report retention |
| #206 | c6870b4a8795740536ca52bf1628a11352affdd4 | Manual default preflight, explicit record choice and bounded GET-only CLI |
| #207 | 18147898f2db896c14a3fa96c778224ee599285a | Offline stored-line replay, grade provenance and receipt chronology |
| #205 SQL only | ecc260b14d55ce62a6a88448ed24faad92417095 | Read-only hosted grants/RLS/trigger/sequence check, strengthened below |

The net edits after #207 are limited to:

- Pin the test, preflight and record checkouts to the same workflow event commit. Immediately verify actual Git HEAD against GITHUB_SHA in each job. The previous record checkout followed moving main and could execute a newer untested tree while its receipt named the older commit.
- Extend the real-workflow regression to refuse a moving-main checkout or a removed HEAD guard. Existing event, credentials and preflight tests remain.
- Include the #205 readiness query, with the additional requirement that append-only triggers fire in normal origin sessions (O or A); a disabled or replica-only trigger is insufficient.
- Exercise that exact query inside a read-only transaction on disposable PostgreSQL: missing schema, repeated setup, excess TRUNCATE grant, repaired grants, disabled trigger, replica-only trigger, always enabled and normally enabled. Also reproduce the original query's false READY on a disabled trigger.
- Add this release note.

The generated owner setup bundle, model artifacts, registered sample minimums, promotion gates, source schedules, budgets, stock session and broker/demo controls are unchanged. There is no new strategy or new performance result.

GitHub checkout semantics: https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683
Workflow context: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
PostgreSQL trigger modes: https://www.postgresql.org/docs/current/catalog-pg-trigger.html

## Verification and limits

The execution workspace failed to start during preparation. No local test result is claimed for these net edits. This candidate must pass GitHub's secret-free study tests, disposable PostgreSQL checks, Python/build checks and responsive QA at its final head before being considered code-ready. Read the PR for the actual run receipts.

The hosted active props project remains inaccessible to the connected account. Browser sign-in was canceled before access could be verified. No hosted migration, preflight, study recording or source capture was performed. The SQL regression uses disposable synthetic databases only.

CI success is separate from operational readiness. The read-only SQL inspects schema configuration; it does not prove write success, an actual worker run, sufficient forward evidence, or model quality. The app's GET preflight proves required table/column reads only.

## Owner release gate

The existing review recommends releasing this chain after the November 23 supervised stock session. This candidate preserves that sequence. Do not separately merge the imported source PRs.

1. In the active props project vfyzbliksooljxrlfadp, run database/props/checks/forward_studies_readiness.sql and retain all rows.
2. If not READY, inspect the reason. The unchanged database/props/forward_studies_setup.sql is the existing setup for absent complete schemas and narrowed grants. It refuses wrong/partial schemas. It does not repair a deliberately disabled existing trigger; that state needs review rather than an automatic workaround.
3. Repeat the read-only SQL and require OVERALL = READY. Permission denial does not establish missing tables.
4. Obtain independent review of #207 and these net edits, require final-head CI, then obtain owner approval for this single candidate's merge into main. Approval for a draft or code review is not release approval.
5. Merging enables the existing future capture shadow and scheduled record triggers. Manual dispatch still defaults to preflight, but the schedule is not disabled. Do not merge before the owner intends that forward start.
6. Immediately run Forward paper studies on main with preflight. Require mode = preflight, status = READY, the active props host and the merged workflow commit.
7. Confirm a later real record receipt and new pre-lock shadow rows before calling the study operational. Never fabricate or backfill missed forward predictions. Keep schema receipts, application preflight receipts and actual recording receipts distinct.

The separate Monday stock research freeze still requires #203 plus a genuine successful Research collect publication before 2026-11-23T14:30:00Z (7:30 AM MST). This candidate does not solve that archive blocker and does not authorize that merge or dispatch. The supervised stock order gate and Kalshi demo STOP remain independent.

## Rollback

No database change is made by this candidate. If deployed, code rollback is a reviewed revert. Preserve all stored evidence and negative findings; do not drop tables or rewrite balances. New legitimate forward records must remain auditable.
