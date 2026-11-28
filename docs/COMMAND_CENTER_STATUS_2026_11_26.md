# Command-center status and evidence coverage

Baseline: production main `fe966317c1a26bca36aae355c8f1c7dd6c607f83` (PR #230).

This reporting milestone adds Kalshi weather research and the learning engine to the home status rail and whole-site chatbot answers. It also shows the learning engine's published evidence-path coverage. It changes no model, registry, gate, sample requirement, stake, provider budget, order path or schedule.

## Sources and limits

| System | Source | What the display establishes |
| --- | --- | --- |
| PrizePicks | Existing props ledger and owner control | Recorded captures, picks, settlements and collection state. Existing performance windows and arithmetic are unchanged. |
| Stock PAPER | Operations monitor and the compiled order-release switch | Planning/monitoring evidence and release restrictions. Healthy jobs never establish that an account is armed or that orders occurred. Private account reads remain owner-only. |
| Kalshi weather | Existing independent-weather and multi-source-shadow workflow receipts | Whether both jobs have current successful receipts, are pending, failed or late. Saved forecasts and forward grading remain on the Kalshi research page. No exchange or account is contacted. |
| Learning engine | Existing hash-verified archive loader | Registry outcomes and reported automatic evidence paths, with the evaluation date. A saved, failed, future or old evaluation cannot establish current learning. |

The dashboard and chatbot use the same pure briefing model. A failure to read the learning archive does not suppress the sports ledger or require private stock access. Engine reads use the existing public archive cache and are added only to relevant status/learning questions.

## Reporting rules

- An old monitor cannot establish current stock automation.
- The source release switch remains authoritative even if a published monitor omits its release blocker.
- Pending first runs, missing required-job/site evidence, published warnings and outstanding blockers cannot produce a green overall status.
- A healthy headline describes **reported jobs**; it does not assert that every account or strategy is executing.
- A late weather job needs attention. Its saved research is retained, and lateness is kept distinct from a failed workflow or an unavailable monitor.
- Coverage counts must be complete nonnegative integers, agree with the verified registry and owner-supplied experiment list, and add up. Missing, duplicate or inconsistent coverage is unknown, never zero.
- The active denominator follows the existing report: it excludes FAILED, REJECTED and READY_FOR_REVIEW experiments. No lifecycle is changed here.
- An automatic evidence path means the existing report identifies a ledger-forward specification or producer. It does not prove that every experiment gained fresh observations on that run. Connected domain inputs alone cannot establish coverage.
- Failed and rejected findings remain visible. READY_FOR_REVIEW means owner review, never automatic promotion.
- Current evaluation evidence uses the loader's existing 48-hour freshness horizon. Saved registry counts remain dated historical information.

## Verification

The deterministic cases cover stale stock checks, disabled order release, incomplete health evidence, separate weather timing/failure states, unknown or mismatched learning coverage, retained negative findings, and public chat source isolation. The PR records final-head verification results and any database-dependent skips.

Relevant commands:

```sh
node --test
npm run lint
npm run build
node scripts/owner-sign-in-smoke.mjs
node scripts/assistant-http-smoke.mjs
node scripts/browser-smoke.mjs
```

The browser suite uses an isolated production build without private provider or database credentials. It checks 56 route/viewport combinations and the learning panel itself at 320, 390 and 1440 pixels. The focused panel checks wait for the streamed status rail and confirm actual viewport intersection before capture. Isolated browser results do not establish hosted database readiness or live exchange access.

## Separate release work

- PR #229's moneyline refresh remains disabled and requires its own duplicate-prevention, per-sport receipt and reservation-contract verification.
- PR #216 still requires fresh hosted readiness (13 READY rows), owner approval of the additive frozen-file hook, and the required manifest follow-through.
- PR #102 still requires the genuine owner-supervised stock session and its existing release gate.
- Preserve the release freeze from November 29, 2026, 6 PM MST through the November 30 stock-gate review. Existing authorized jobs continue under their current controls.
