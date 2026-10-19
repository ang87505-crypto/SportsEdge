# Daily PAPER risk checks and incomplete drawdown reporting

This patch is based on PR #73 at `b680bf18a907e77cf5026b6bdd31449bbc913b36`. It is the first repair from the October 19 stock-strategy audit. Review it against `claude/paper-auto-dashboard`; the prerequisite PR stack remains separate.

## Problem and resulting behavior

The execution path already checked the capital ceiling and drawdown threshold. Daily monitoring and reconciliation could observe a breach without enforcing those same limits, including between monthly decisions. A skipped, unreconciled trough could also leave the dashboard showing zero maximum drawdown.

The execute, reconcile and monitor paths now share one exact-integer risk check. Equality with a configured limit remains allowed; a strict breach records STOP. Reconciliation cannot produce clean resume evidence while the account is in breach. An unavailable benchmark cannot hide a breach already observed in fresh account equity.

For an uncontaminated, cash-reconciled daily mark, the database saves the mark and records any risk STOP in one transaction. A lost worker reply or failed follow-up STOP request cannot leave that marked breach ARMED. Duplicate marks remain idempotent. Existing external-activity and cash-attribution rules retain their own stop reasons.

The performance result exposes `observedMaxDrawdown` and coverage metadata. `maxDrawdown` is null if an unreconciled mark was skipped. The dashboard displays **Incomplete** for that case and labels other values **Observed drawdown**. Calendar completeness and intraday drawdown are not measured by this patch.

STOP prevents new submissions and cancels working strategy orders when the worker runs. It does not liquidate existing holdings. The owner interface now says that holdings remain exposed to price changes.

## Validation completed locally

- 61 focused Node tests passed: risk boundaries and exact products, observer dispatch, performance, portfolio rebalancing, broker, owner and worker behavior; zero failures or skips.
- The complete SQL contract returned `PAPER_AUTO_V1_POSTGRES_PASS` on PostgreSQL 18.3 / PGlite 0.5.8 for a fresh schema and for the pinned previous v1 schema with the upgrade applied twice.
- Five controller scenarios passed against the actual SQL in each of those two database configurations: midmonth drawdown monitoring, a lost follow-up STOP request, reconciliation during a breach, a failed benchmark read, and the capital ceiling. These used a synthetic broker and single-connection PGlite, not an Alpaca account.
- `npm run build` passed, including TypeScript. `npm run lint` passed with two existing unused-variable warnings in `alpaca-owner-first-order.test.mjs`.
- The diff leaves strategy definitions, release flags and operational workflow schedules unchanged.

The native PostgreSQL 17 controller suite and independent-connection race suite still require CI. The local runtime maps only UID 0 and cannot start a normal non-root PostgreSQL server. PGlite validation does not substitute for concurrency coverage. The PR must not be treated as ready to merge until those native checks pass.

To repeat the focused Node checks:

```sh
node --experimental-strip-types --test \
  src/lib/server/paper-auto-risk.test.mjs \
  src/lib/stocks/paper-auto-performance.test.mjs \
  src/lib/stocks/paper-strategy-rebalance.test.mjs \
  src/lib/server/paper-auto-broker.test.mjs \
  src/lib/server/paper-auto-owner.test.mjs \
  src/lib/server/paper-auto-worker.test.mjs
```

The controller CI also runs the real-schema controller tests. SQL CI checks fresh installation, a twice-applied upgrade from the pinned prior schema, the full SQL contract and existing independent-connection races on PostgreSQL 17.

## Database rollout

For a fresh disposable database, use the updated `database/staging/paper_auto_v1.sql`. For an existing v1 installation, review and apply `database/staging/paper_auto_risk_v2.sql` before deploying the updated worker. The upgrade replaces the daily-mark function and adds private helpers; it is transactional and idempotent. It does not rewrite existing marks or change account limits, registration, release flags, or schedules. The private helpers are not exposed to client roles; the existing service-role-only RPC grant is retained.

No shared database was migrated during this work. This patch opens no trading session, places no real or paper broker orders, and enables no scheduled automation.

## Remaining work

Native CI and independent review come first, followed by integration of the prerequisite PR stack. The next operational milestone is a verified market-data capture and reproducible decision-to-ledger paper run under the existing release gates. Evidence of a profitable trading edge still requires realistic costs, untouched out-of-sample evaluation and forward observations; these engineering tests establish behavior, not investment performance.
