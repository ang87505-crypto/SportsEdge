# Alpaca PAPER one-shot writer contract (UNRELEASED)

**Status 2026-10-14: broker writing, scheduled execution and live trading are OFF.**
Implemented a locked-down server-only PAPER writer contract as a preparation for
the first controlled order, not an enabled trader or profitable strategy.

- Fixed host: `https://paper-api.alpaca.markets/v2/orders`; no live-trading URL.
- Exactly one share, buy/limit/DAY, $0.01–$25.00 limit, regular-hours only.
- Source identity must match the deterministic staging `client_order_id`.
  Manual unverified drafts created by the v4 RPC DO NOT qualify.
- Expected server-side receipt: `submitting`, version 2, independently verified
  owner's exact approval, near-real-time quote, reconciled cash/account/orders,
  dated signal, session-close buffer, and a matching durable claim.
- A **real** future flow must make an atomic, database-enforced transition
  from owner-approved version 1 to submitting version 2, check the independently
  operational STOP immediately before posting, and persist every acknowledgment
  or ambiguous reply. Retries after uncertain receipt are forbidden.
- Any unknown provider response, timeout, non-2xx, malformed JSON, mismatched
  economics, or failed receipt write must remain locked as uncertain and demand
  authoritative broker read-only reconciliation. HTTP 4xx is not proof that a
  POST was never accepted.
- GitHub release manifest hardcodes `placeOrdersEnabled:false` and the other
  operational capabilities disabled. The module's first runtime check rejects
  ALL callers before touching a claim, credential or HTTP client. There is no
  HTTP route, cron or UI to invoke it.

## What remains

1. Review and ship a least-privileged runtime database claim/receipt port with
   concurrency tests and a trustworthy monotonic operational stop (different
   from the permanent staging HALT).
2. Verify market-calendar/quote source and independently verified stock signal
   from a service, not manually typed fields or browser flags.
3. Implement authoritative broker order and position reconciliation at release
   boundaries, including pending/partial fills and provider timeouts.
4. Restore Vercel team authorization and securely install the separate staging
   service key (Preview environment only). No secrets belong in GitHub or chat.
5. Test actual controlled PAPER account flow on deployed Preview, then ask
   the owner for exact one-share symbol/price/order time approval.
6. Only after successful end-to-end single-order verification, separately
   authorize limited recurring schedules and monitored operator stop access.

**Do not turn on release flags by changing environment variables.** The safety
system is intentionally unavailable until all missing pieces and exact-head CI
have been reviewed. This PR cannot create any Alpaca order in its current state.
