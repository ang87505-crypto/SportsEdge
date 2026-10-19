# PR verification without duplicate production builds

This change is based on main at `4d0bd2c4ce9578482f98b3725148bfca333e07e8`.

Every pull request currently starts four production builds. The revised workflows start two: the shared lint/build/typecheck job and the separately configured browser smoke job. Provider-contract tests and historical-data reproduction still run on every PR. No test command is removed.

| Check | PR owner after this change | Legacy push behavior |
| --- | --- | --- |
| Python statistics and audit tests | Verify SportsEdge | Unchanged |
| Performance series, journal, PAPER diagnostics | Verify SportsEdge | Unchanged |
| Lint, production build, explicit TypeScript check | Verify SportsEdge | Each existing push entry point retains its independent checks |
| Provider normalization, research math, results and stock tests | Dual-track verification | Unchanged |
| Pinned historical-data reproduction | Diagnostics | Unchanged |
| Desktop/mobile smoke with its own build and screenshots | Browser QA | Manual dispatch remains available |

The redundant Diagnostics build job is skipped on PRs. The redundant Dual-track lint/build/typecheck steps run only for that workflow's existing push trigger. The explicit `npx tsc --noEmit` check follows the shared build so generated Next route types exist. Workflow names, job identifiers/display names, triggers and read-only permissions are preserved.

New concurrency groups include the workflow, event and PR number. A newer commit cancels obsolete work on that same PR within that workflow. Push and manual runs use their own run ID and do not cancel one another. Previously unbounded jobs now have a 15-minute timeout; browser QA retains its existing 12-minute timeout.

## Validation and limits

- All four changed workflows pass actionlint (WASM package `actionlint@2.0.6`) with zero findings.
- A YAML comparison against the pinned main baseline verifies unchanged workflow names, triggers, permissions and job names; all original command types remain reachable for their original event types.
- The comparison confirms four to two `npm run build` invocations per PR, one shared lint command and one explicit typecheck. `git diff --check` passes.

This is a reduction in duplicated build invocations, not a measured percentage reduction in billed minutes. It does not replenish the account's exhausted Actions allowance or alter budgets. Hosted execution still needs an available runner. The separate recurring PAPER SQL/controller workflows in the pending PR stack are outside this main-based change; their native PostgreSQL and independent-connection tests remain required before release.

No application code, strategy definitions, release flags, trading schedules, secrets, billing settings or databases are changed.
