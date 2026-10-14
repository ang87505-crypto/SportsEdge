# SportsEdge — one-share test draft before first Alpaca PAPER order

**Engineering status: draft preparation only; NO broker order, NO schedule, NO authenticated Preview acceptance.**

The owner has indicated willingness to authorize a first small paper test. That
is NOT an order-specific release decision: no symbol, verified market quote,
limit price, share count, session or test-expiration were supplied. This
milestone prepares the approval interface and a durable unapproved staging
record, while keeping broker execution fully disabled.

## Added workflow

- The owner-only private Alpaca PAPER dashboard includes a
  **Prepare your first paper-trade test** section. It accepts exactly
  **one** whole share and a US-dollar limit of at most **$25.00**.
  Tickers are strictly `[A-Z]{1,5}`; this is a syntax check, **not**
  a market-data or instrument-eligibility check.
- A clearly named `Save unapproved staging draft` action
  POSTs JSON under the existing short-lived private owner-cookie
  and exact-origin requirement. Only `symbol`, `shares:1`,
  `limitCents` are accepted. No other fields, URLs, order types,
  extended trading hours, live account or automatic schedule.
- The server generates an unpredictable `preview-...` ID,
  deterministic internal client ID from that ID, and a SHA-256
  digest explicitly labeled `UNVERIFIED_MANUAL_DRAFT_NOT_A_MARKET_SIGNAL`.
  The digest must **not** be presented as a reviewed model signal.
- The staging-only function `public.sportsedge_paper_stage_preview`
  persists only a `planned` record under the fixed locked
  `sportsedge-paper-stage` alias. It verifies that a permanently
  HALTED gate exists, enforces a 20-draft staging cap under an
  advisory transaction lock, and disallows mutation under a
  conflicting intent ID. Role grants are service-role-only;
  `PUBLIC`, `anon` and `authenticated` are revoked.
- The response always has `approved:false`,
  `executionPermitted:false`, `brokerCalls:0`,
  `gateHalted:true`. Staging records cannot be promoted to
  `owner_approved` while the v2 HALT trigger remains installed.
- On upstream timeouts the client explicitly **does not
  automatically retry**. It may not know whether the staging
  record was stored, and it must not claim the test happened.
- The fixed staging server key remains necessary for the
  authenticated Preview to save drafts. It must never be placed
  in a GitHub PR, frontend environment variable or chat.

## Work remaining before the first actual paper order

1. Vercel must deploy the main/Preview code after its build-rate
   limit expires, and its connected app must be reauthorized
   (currently 403). No upgrade or new spending is authorized.
2. The separate **staging-only server credential** must be
   configured securely in Preview and verified without disclosure.
3. The owner must confirm the **exact** stock symbol, one share,
   maximum limit USD, valid market window and worst-case
   virtual-dollar risk. The draft form is merely a proposal.
4. Verify the PAPER broker account and full order/position
   inventory and quote freshness, with stock-eligibility checks.
5. Implement and validate a separate transactionally claimed,
   owner-authorized, **one-shot** broker writer, with an
   operational emergency stop, broker reconciliation and
   recovery for ambiguous HTTP responses.
6. Conduct a fully controlled, explicit, exact-order PAPER
   acceptance with one order before any unattended recurring
   execution. No profitability claims are justified by that
   engineering test.

**A draft is never a trade.** No live-money host is used, and
there is no code in this feature that can submit Alpaca orders.
