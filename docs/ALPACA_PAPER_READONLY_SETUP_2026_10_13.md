# Alpaca paper connection — stage 1 (read-only, server-side)

**Status:** GitHub PR only, unmerged. Owner must set private env vars; no broker connection made by this PR; no automated order writes or paper bets. SportsEdge's existing Alpaca shortcut is navigation only, not an authenticated sync.

## What ships
- A server-side **strictly paper-hosted** HTTP reader, with an endpoint allowlist of GET \`/v2/account\`, GET \`/v2/positions\`, and GET \`/v2/orders?status=all&limit=25&direction=desc\`. No order-submit, cancel, replace, broker write, market-data ingestion or configurable host.
- Admin-token-protected \`GET /api/internal/alpaca-paper\`, without a public authenticated UI. It reads account equity/cash and a *bounded* positions/recent-orders snapshot. Never treat the snapshot as a reconciled complete order ledger.
- Explicit warnings for blocked accounts, short positions, unknown/open recent orders, and the 25-order history cutoff. Reports **not authorized for execution** regardless of warning count.
- Synthetic tests, no provider network/API bill, no secrets in code.

## User: create credentials, but do NOT paste secrets into chats
1. Go to https://app.alpaca.markets and create/sign in to a **Paper Trading** account. Paper-only account is free. Paper API credentials are different from live credentials.
2. Choose **Paper Trading** at top of dashboard; open **API Keys** and generate/show **paper key ID and secret**. A new secret might only be displayed once; save it privately.
3. After the PR is independently reviewed and merged/deployed, add these **server-side Vercel** environment variables to the *existing* SportsEdge project:
   - \`ALPACA_PAPER_KEY_ID\` = Alpaca **paper** Key ID.
   - \`ALPACA_PAPER_SECRET_KEY\` = Alpaca **paper** secret.
   - \`SPORTSEDGE_ALPACA_PAPER_READ_TOKEN\` = independent random secret (32+ chars) used to guard the server-side diagnostics endpoint. Generate using \`python -c "import secrets; print(secrets.token_urlsafe(48))"\` on your own machine.
4. Never use \`NEXT_PUBLIC_\`, commit credentials, put them in Supabase publicly, or send them in chat.
5. Configure only the intended Vercel environment(s), and redeploy. A trusted admin program can query the internal route with \`Authorization: Bearer <SPORTSEDGE_ALPACA_PAPER_READ_TOKEN>\`. This is *not* an approved browser-login flow.
6. Do not install an Alpaca live key in any SportsEdge stock project. The code pins \`https://paper-api.alpaca.markets\` and forbids mutation methods.

## Not yet shipped
- No automatic paper-trade placements or broker-side emergency-stop endpoints.
- No signed owner UI/authentication, scheduler, broker webhook/event persistence, idempotent order receipts, persisted reconciled NAV, or alerts.
- The read-only API may return status warnings but **does not block third-party trading**: blocking new orders only works after a separately gated execution service is built.
- Historical stock model still not validated against real full-market point-in-time data and corporate actions. PRs #43 and #45 address offline research. Keep QuantConnect Free for cloud backtesting.
- **Alpaca Basic stock market data is IEX-only for real-time equity prices**. SportsEdge's frozen full-market $20M/20-session dollar-volume criterion requires separately verified consolidated volume and source comparability. Do not treat IEX as SIP and do not silently change the algorithm.
- Sports betting paper experiments are **separate** from Alpaca (an equities brokerage). They require their own odds/results infrastructure.

## Before paper-order automation could be approved
1. QuantConnect historical benchmark/run and source parity verified; strategy and execution assumptions frozen.
2. Reliable data feed, market-state/calendar and 08:00 New York signals; liquidations and dividends accounted for.
3. Broker cash/positions/open orders and settled cash independently reconciled.
4. Durable schedule, idempotent order IDs, signed command receipts, retriable uncertain orders, max exposure/daily loss caps, alerts, automatic stop-new-orders and manual owner stop switch.
5. Separate explicit paper-trading authorization after deterministic tests. **Never automatically enable live execution.**

## Official sources
- https://docs.alpaca.markets/us/docs/paper-trading
- https://docs.alpaca.markets/us/docs/authentication
- https://docs.alpaca.markets/us/docs/about-market-data-api
- https://docs.alpaca.markets/us/reference/getaccount-1
- https://docs.alpaca.markets/us/reference/getallopenpositions
- https://docs.alpaca.markets/us/reference/getallorders-1
