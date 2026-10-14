# First owner-approved Alpaca PAPER order — release candidate

Scope: ONE one-share BUY LIMIT DAY order (up to USD 25.00) via Alpaca
`paper-api.alpaca.markets` only, explicitly confirmed by owner in
the private dashboard. NOT an algorithmic stock signal, recurring execution
or real-money trading. The live stock and bankroll research is independent.

Safety contract:
- Only Vercel PREVIEW for branch `acceptance/alpaca-paper-first-order`.
- No order without owner session + Origin check + exact confirm string, stock
  symbol and limit cap. Every POST recomputes the broker account, entire order
  inventory, market clock, tradable stock asset and latest 60-second IEX quote.
- Separate staging-only migration v6 adds a first-order lifetime unique index,
  owner-approval record, source quote/expiry proof, atomic receipt CAS, and a
  narrowly conditioned modification of v2 permanent HALT. Account may be
  unhalted ONLY during the exact claimed one-shot attempt. Emergency STOP
  remains callable; attempting to rearm after a claimed order fails closed.
- Receipt ACK or uncertain response committed durably by RPC. Any 4xx/5xx,
  timeout, broker mismatch or lost DB receipt is ambiguous, requires account
  reconciliation; NEVER retry automatic POST. STOP requested in finally.
- Existing automation release flags for placeOrdersEnabled, scheduledOrdersEnabled,
  realMoneyEnabled stay false. Only `manualOwnerOneShotEnabled` enables the
  branch-restricted one-owner-click flow after CI and staging validation.
- No browser Alpaca/Supabase/service credentials. No Production database
  migrations or external brokerage account charges.
- Quote is IEX-only, not guaranteed executable across all venues. A successful
  order ACK is NOT an actual fill, and is not evidence the stock algorithm works.

Operational requirement:
Keep the staging-only branch key. Remove any unrestricted Preview duplicate of
the staging service credential. Verify target Preview deployment contains v6
schema and the same branch revision, and perform synthetic test/failure
simulations BEFORE asking the owner to authorize the first real PAPER order.
No order should be submitted as part of CI, tests or deployment.
