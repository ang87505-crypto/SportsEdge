# Recurring Alpaca PAPER controller: database contract v1

Date: 2026-10-17. Status: **staging design, not applied anywhere.** No Supabase project,
broker account or scheduler has been changed. Nothing in this file calls a broker.

`database/staging/paper_auto_v1.sql` is the durable state for a recurring, PAPER-only
executor of Astra's frozen `stock-forward-rebalance-v1` planner (PR #67). It lives in its
own schema, `sportsedge_paper_auto`. The v1-v6 lifetime one-order gate is untouched,
and the one-order acceptance route stays independent of it.

## Exposure

- Only `service_role` may execute the 21 `public.sportsedge_paper_auto_*` RPCs. Each one
  is `SECURITY DEFINER` with `search_path=pg_catalog` and takes a single `p jsonb`; the
  PostgREST body is `{"p": {...}}`.
- No role has schema, table or internal-function privileges. RLS is enabled and forced
  on every table.
- `owner_ref` values are opaque hashes. The calling API route must authenticate the
  owner before passing one in.
- The dashboard read model (`ledger`) masks owner references and shows only the last
  four characters of the account number. `worker_state` holds the broker account id and
  is for the server-side worker only.

## Gate and operator status

| Gate mode | How it is entered |
| --- | --- |
| `STOPPED` | At registration (default). `stop` is always allowed, idempotent and audited, and voids every unsent `reserved` intent. |
| `PAUSED` | `pause`, by the owner, from `ARMED` only. |
| `ARMED` | `resume` only. A transaction-local flag is set inside that RPC, so a direct update is refused. |

`resume` requires all of the following:
- the expected gate version (compare-and-swap);
- a `reconcile` run that succeeded within 15 minutes, finished strictly after the last gate change, and reported `clean: true` for the registered account id;
- no reserved, submitting or uncertain intent;
- no unacknowledged critical alert;
- an experiment window that has not ended.

`status` derives the operator state:
- `STOPPED` and `PAUSED` mirror the gate.
- `EXECUTING` means a run holds an unexpired lease.
- `READY` requires all of: a passing check within 26 hours, no unresolved submission, no open critical alert, and the window still open.
- Anything else is `BLOCKED`.
- `realMoneyEnabled` is always `false`.

No scheduler, client flag or cached status can bypass STOP. Every reservation and every
claim locks the gate row and re-reads the gate mode.

## Runs, leases and fencing

- A scheduler delivery calls `begin_run(experiment, kind, slot)`.
  - Duplicate deliveries of a running slot return `SLOT_ALREADY_RUNNING`.
  - A finished slot returns `SLOT_ALREADY_FINISHED`.
  - A run whose heartbeat is more than 10 minutes old is abandoned and its lease is deleted. The next attempt then starts, up to 5 attempts.
- Run ids are deterministic per experiment, kind, slot and attempt.
- Only `execute` and `reconcile` runs take the single per-experiment lease, which lasts 5 minutes.
  - A heartbeat renews the lease only while it is still unexpired. A stalled run whose lease lapsed cannot revive it, and it can no longer reserve or claim.
- The gate row is always locked first, which serializes STOP, claims and lease changes without deadlocks. The race script includes a lock-order test for this.

## Decisions

There is one immutable decision per experiment and New York session. HOLD, MISSED and
INPUT_REJECTED sessions are recorded too.

A `TARGETS` or `HOLD_NO_TARGETS` signal must match the registered experiment, model,
signal version, decision id and decision time. Its `observedAt` must fall within 60 seconds
after the decision, and never in the future. A decision cannot be recorded for a future
time or outside the registered window. Re-recording identical content is a no-op; anything
different is `DECISION_CONFLICT`.

## Order intents

- Each intent id is a hash of experiment, decision, security, side, phase and attempt. Its `client_order_id` is `sepa` followed by 40 hex characters derived from the intent id.
- Uniqueness is enforced on:
  - the client id;
  - experiment, decision, security, side, phase and attempt together;
  - one live or unresolved intent per security.
- A reservation is all-or-nothing, covers one planner phase, and requires all of:
  - an `ARMED` gate;
  - the lease;
  - a weekday between 09:30 and 16:00 New York (coarse; holidays come from the broker calendar in the worker);
  - the experiment window;
  - a decision for **today's** session made before now (no backdated or late orders);
  - a snapshot from the same run, at most 60 seconds old;
  - equity within the registered capital limit;
  - no drawdown breach from the after-close high-water mark.
- The planner's own invariants are re-checked against the recorded decision inputs and snapshot:
  - every leg is in the decision's prior inputs with the same symbol, and within `prior_adv20_shares / 100`;
  - a BUY must be a decision target, and `(shares + held) × limit + fee` must not exceed equity / 10;
  - the BUY total plus fees must fit within settled cash;
  - exposure across the legs must stay within equity / 2;
  - a SELL can never exceed the shares held.
- Caps: per-order notional, daily notional, daily order count and open orders.
- Retries:
  - A new attempt is allowed only after `canceled`, `expired`, `not_submitted` or `confirmed_absent`, and only up to the per-leg limit.
  - A filled leg is never re-entered.
  - A **rejected leg is never retried automatically.**
- `claim_intent` moves an intent from `reserved` to `submitting`. It is the only path to a broker POST. It requires the gate, the lease and regular hours, a reservation less than 5 minutes old, and **no other submission whose outcome is unknown** (one POST in flight at a time).

| From | Allowed next states (broker observations through `record_order`) |
| --- | --- |
| reserved | not_submitted |
| submitting | open, partially_filled, filled, canceled, expired, rejected, uncertain |
| uncertain | open, partially_filled, filled, canceled, expired, rejected (broker evidence with an order id only) |
| open | open, partially_filled, filled, canceled, expired, rejected |
| partially_filled | partially_filled, filled, canceled, expired |

- Fills are monotonic and bounded by the order quantity, and every fill needs a price.
- Broker order ids are immutable once set.
- Economics and identities are immutable after reservation.
- Every change takes a compare-and-swap version and appends an intent event.
- Re-observing the same state is a no-op.
- An explicit HTTP 400, 401, 403 or 422 refusal of the POST may end a leg as `rejected` without a broker order. A 422 duplicate-client-id refusal (`40010001`) is never a rejection; the worker must look the order up by client id.

## Unknown POST outcomes

A timeout, network error, 5xx, 429 or unparseable response becomes `uncertain`. It is never
retried and never treated as failed. While it is unresolved, no new reservation or claim is
possible and resume is refused.

An uncertain intent can leave that state only in two ways:
1. a broker observation of its client order id (it was found);
2. `confirm_absent`, by the owner, after 16:15 New York on that session. This requires `history_complete: true` and two lookups made after the close: a client-id lookup and a complete order-history check.

A missing lookup on its own changes nothing.

## Activities and the daily ledger

- Activities are attributed by broker order id. A FILL of a recorded intent must be a `strategy_fill`, and any other FILL must be an `external_fill`. While any submission outcome is unknown, unattributable fills are refused (`FILL_ATTRIBUTION_PENDING`) rather than guessed.
- Re-recording an activity is idempotent; changed content is a conflict.
- `record_daily` writes one immutable mark per session, captured after 16:15 New York on that session or later.
  - External flows, fees and dividends come from the recorded activities, not from the caller.
  - Any external fill, corporate action or unsupported activity on or before the session sets `contaminated`, on top of the caller's own flag.

## Clock

Every rule and column default reads `sportsedge_paper_auto._now()`, which returns
`clock_timestamp()`. The disposable test databases replace that function to pin time to
explicit New York session times, including the 2026-11-01 DST change. Only the schema
owner can replace it.

## Verification (disposable PostgreSQL 16 locally; CI uses 17)

```
psql -f database/staging/paper_auto_v1.sql
psql -f database/tests/paper_auto_v1.sql          # PAPER_AUTO_V1_POSTGRES_PASS
bash database/tests/paper_auto_v1_race.sh         # PAPER_AUTO_V1_CONCURRENCY_PASS
```

- The contract suite makes 120 refusal assertions and 80 equality assertions.
- Fourteen hand-made mutations, each removing one guard, were all caught by the suite. The guards were:
  - claim without ARMED; claim without the unknown-outcome barrier;
  - retrying rejected legs; buying a non-target; uncertain to not_submitted;
  - STOP keeping reserved intents; drawdown disabled; confirming absence before the close;
  - resume without a clean reconciliation; backdated decisions;
  - a duplicate client id treated as a rejection; reserve without the lease;
  - misclassified fills; ignored contamination.
- The race script uses independent connections. It shows:
  - one run from 8 duplicate deliveries;
  - one lease holder;
  - one persisted reservation and one successful claim;
  - one compare-and-swap winner;
  - STOP against a claim always ending in either "claimed, then stopped" or "voided and refused" (6 trials);
  - concurrent STOPs changing the gate once while auditing both;
  - one takeover of a stale slot;
  - no deadlock between finishing and acquiring a lease.

## Not covered here

- The database trusts the worker's broker observations; it cannot authenticate Alpaca data.
- Market holidays, early closes and quote freshness are enforced by the planner and the worker, not by this schema.
- Applying this migration to staging or production, registering an experiment, and arming it each require separate owner authorization.
