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

## Local verification when a hosted runner is unavailable

After installing the locked dependencies with `npm ci`, run:

```sh
npm run verify:local
```

Use Node.js 24 and Python 3. The command uses `python3` on Unix or `python` on Windows; set `PYTHON` to an executable path if needed. It runs the core PR checks in sequence: deterministic Python tests, the combined provider/research/stock/UI-safety Node tests, lint, production build, the generated-route TypeScript check, and the pinned historical-source replay. The replay downloads the original files from the pinned upstream commit and therefore needs network access. No service credentials are required.

The runner resolves installed tools, expands test files without a shell, closes child stdin, and gives each step a ten-minute limit with termination followed by a forced stop after five seconds. A failed, missing, interrupted or timed-out command stops the sequence and returns a nonzero exit code. `SPORTSEDGE_LOCAL_CORE_PASS` is printed only after all six stages succeed. The runtime disables PAPER runs for its child processes. The usual Next build output, generated route declarations and TypeScript cache may appear in the local checkout; this command does not commit them.

Local verification on Linux used Node 24.19.0, Python 3.12.14 and the existing locked dependencies. CI specifies Python 3.13; that version and Windows execution were not verified here. Before applying this PR, every one of the 291 tracked files in the local main snapshot was matched to its GitHub blob hash at the pinned baseline above. The full command then passed against that snapshot plus this PR's workflow/tooling changes:

| Check | Result |
| --- | --- |
| Python statistics and audit tests | 234 passed |
| Combined provider, research, stock and UI-safety Node tests | 82 passed; no failures or skips |
| Lint | No errors; three existing warnings |
| Production build and generated-route typecheck | Passed |
| Production HTTP smoke, run separately | Ten public routes rendered; the uncredentialed private broker view returned 503 with private/no-store headers |
| Historical-source replay | Reproduced all 579 frozen match records and metrics |
| Runner failure handling | Nonzero child exit and missing executable both prevented later stages and the success marker |
| Runner timeout handling | An accelerated temporary probe killed a child that ignored SIGTERM and returned failure |

The local command is a core-check fallback. Browser interaction/responsive QA and native PostgreSQL/controller concurrency suites remain separate requirements. Local results do not create or replace GitHub check statuses, replenish Actions minutes, or establish trading performance.

This is a reduction in duplicated build invocations, not a measured percentage reduction in billed minutes. It does not replenish the account's exhausted Actions allowance or alter budgets. Hosted execution still needs an available runner. The separate recurring PAPER SQL/controller workflows in the pending PR stack are outside this main-based change; their native PostgreSQL and independent-connection tests remain required before release.

No application behavior, strategy definitions, release flags, trading schedules, secrets, billing settings or databases are changed. The package adds only the local verification script entry point; dependencies and the lockfile are unchanged.
