# Stock historical data — read-only Alpaca archiver (October 2026)

## What was built

A real provider-specific historical-data collection **interface**, kept separate from the existing stock-momentum model and from the historical cash ledger in PR #27.

**New files only:**
- \`analytics/alpaca_history_archive.py\` — authenticated, bounded archival client with zero-network default.
- \`analytics/test_alpaca_history_archive.py\` — offline mocked Alpaca response and pagination tests.
- This document.

Existing website, database, stock selection, execution planner, and virtual accounts were not edited. The branch is based on PR #27, which depends on PR #19, #18 and #16. The provider adapter does not promote or alter their algorithms.

## Official API and provenance

API documentation inspected:
- Daily stock bars: https://docs.alpaca.markets/us/reference/stockbars
- Corporate actions: https://docs.alpaca.markets/us/reference/corporateactions-1

Historical bars support \`adjustment=raw\` and an \`asof\` **symbol mapping date**. They are NOT historical end-of-day publication timestamps, and mapping today's stocks backward is NOT a survivorship-free historical universe. Provider data access differs by \`iex\` versus \`sip\` feed and account entitlements.

Corporate actions include distributions, splits, mergers, name changes and removals. Alpaca states that action record creation times **are not guaranteed** and that reported events can arrive or be processed late. The archiver captures pages as evidence but does not assert complete corporate action coverage, or infer which facts were known by each past decision.

Source responses are stored with deterministic JSON page hashes, actual request parameters, retrieval/capture time and a content revision. The archived JSON **never** includes Alpaca credentials, simulated trades, performance numbers, fake historical availability timestamps or claims that observed prices were executable.

## Two command modes

**1. Plan without any API credits, authentication or output file:**

    python analytics/alpaca_history_archive.py --symbols AAPL,MSFT --start 2025-01-01 --end 2025-12-31 --asof 2025-12-31 --feed iex --max-requests 8

The plan shows the minimum expected HTTP GET requests (one stock bars page and one corporate-actions page per symbol), plus a strict ceiling. The number of billable data credits may differ. No provider calls occur.

**2. Explicitly approved, bounded archival collection** (AFTER confirming account feed permissions, cost and that historical data usage is allowed):

    # Set APCA_API_KEY_ID and APCA_API_SECRET_KEY as local environment variables.
    # Never paste them into the command or ChatGPT.
    python analytics/alpaca_history_archive.py --symbols AAPL,MSFT --start 2025-01-01 --end 2025-12-31 --asof 2025-12-31 --feed iex --max-requests 8 --execute-network --output new-alpaca-source.json

By design, \`--execute-network\` is mandatory for provider calls. \`--output\` must refer to a NEW file; an existing path refuses the network call. If provider keys are missing, no request occurs. HTTP failures, duplicate daily bars, bad OHLC, repeated pagination cursors or an exhausted request cap abort without a partial-success archive. Source pages are not stored in Supabase; review applicable license, compliance and retention rules before any website display.

**The example above is a suggested future command, not something that was executed in this development milestone.** No paid data, credential checks or trade calls have been made.

## Why this is not yet a real stock profit backtest

There are three separate stages:

1. **Collect authentic source evidence:** raw historical daily bars, corporate actions, metadata, request times and hashes. This archiver is designed for that stage but has not yet connected to a verified authorized account.
2. **Validate and normalize as-of inputs:** real trading calendar, historical universe including delisted companies, stable security IDs, ticker history, reliable split and dividend events, genuine as-of availability, IPO eligibility and data rights. The current data contract in PR #16 fails closed for absent required timestamps. Never simply call a historical price timestamp the availability timestamp.
3. **Reconstruct decisions and simulate fills:** use the frozen PR #18 stock momentum signal with only stage-2 past data, feed immutable targets into the PR #27 cash ledger with explicit next-open fill proxies/fees, score benchmark and holdout without cherry-picking.

Stage 2 is still a real research/data engineering blocker. The archived set of today's surviving stocks cannot establish an unbiased backtest. Even a complete archive from Alpaca may need an additional historical-security master, delisting data and provider usage approval. No financial return from stocks is claimed.

## Verification

    python -m unittest analytics.test_alpaca_history_archive -v
    python -m unittest discover -s analytics -p 'test_*.py' -q

Repository CI should also run its existing Node, lint, TypeScript and Next build checks. All provider interactions in CI are fake Python functions returning synthetic pages. The work requires no secrets.

## Handoff to Astra / Work

NBA research is already ready to audit using PR #28, which has a longer-run losing ROI scenario. For STOCK algorithm improvement, first require authenticated and licensed historical market snapshots with complete point-in-time universe and corporate action evidence; don't tune a model against invented or selectively sampled stock prices.

Before a general production release, reconcile the existing open PR stack in dependency order. These research tools are **drafts, not deployed features**. Do not blindly merge all stacked changes.
