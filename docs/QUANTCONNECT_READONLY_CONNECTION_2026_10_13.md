# QuantConnect connection — owner-only read-only groundwork

This is a **server-side, unmerged integration proposal**, not an active account connection. No token has been collected or used. The API route does not place orders, run backtests, change QuantConnect projects, export market data, or publish claimed SportsEdge strategy returns.

## Endpoint (requires paid QuantConnect API access, plus code review and deployment)
- `GET /api/internal/quantconnect?action=verify`: checks a server-side QuantConnect credential against QuantConnect's documented `/authenticate` endpoint.
- `GET /api/internal/quantconnect?action=list`: reads up to 25 recent **metadata-only** backtest entries from the configured project. It does not expose P/L, raw market data, logs, or order history.
- Both routes require a constant-time verified `Authorization: Bearer <SPORTSEDGE_QC_READ_TOKEN>` header. No anonymous website endpoint or publicly readable connection status. Server code never echoes secrets or raw upstream errors.
- The browser interface is intentionally **not** connected: SportsEdge currently lacks an independently verified owner login. Do not put this bearer token into client code, browser localStorage, URLs or `NEXT_PUBLIC_` variables.

## Access restriction: QuantConnect Free does not include API credentials

**Do not ask the owner to purchase an organization subscription solely to connect SportsEdge.** QuantConnect restricts API-token access to paid organization tiers. PR #46 is optional future groundwork for a paid QuantConnect organization; it does not work with the current Free plan. Keep this PR a draft and unmerged until there is a clear cost-benefit justification.

**Free-plan alternative:** use QuantConnect's web terminal for cloud backtesting. On a completed backtest open **Overview > Download Results** to save permitted performance statistics, charts and orders as JSON; reports and trade summaries can also be downloaded. Keep results private (do not use Make Public) and never attempt to extract underlying hosted market data. A separate, explicitly reviewed SportsEdge import path will be required to validate and display these results. No such import route is implemented by this PR.

## User configuration — paid organization only, not recommended yet (do not paste values into ChatGPT or GitHub)
If you later elect to pay and after reviewing/merging the PR, open QuantConnect > profile menu > My Account > Security > **Request Email With Token and Your User-Id for API Requests**. This key may have broader QuantConnect API capabilities than our read-only code; keep it secret.

In Vercel > the existing SportsEdge project > Settings > Environment Variables, set **server-side**:
- `QC_USER_ID`: your QuantConnect account user ID from the email.
- `QC_API_TOKEN`: the private token from that email.
- `QC_PROJECT_ID`: your *existing* SportsEdge-Stock-Research project identifier shown in its QuantConnect project URL (the screenshot in this chat shows `37781863`).
- `SPORTSEDGE_QC_READ_TOKEN`: a **different**, long random secret (32+ characters) to protect SportsEdge's internal read-only endpoint. Generate locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and keep the result private.

Don't add these to GitHub, your Next.js client, or public Supabase tables. Scope Vercel environments intentionally and redeploy after adding secrets. The response stays private. Users would need to test with a trusted server/admin client that provides the bearer header; no public UI is enabled.

## Independent safety and backtest gates
The existence of a QuantConnect backtest called SportsEdge does not establish parity with the frozen `stock-mom252-skip21-trend200-v1` and `stock-mom252-skip21-trend200-holdrank10-v1` strategies. The successful earlier 2000–2011 SPY data check has **zero orders** and cannot be presented as verified stock profit.

The frozen full-market 2000–2011 development backtest still needs source universe and sector coverage, raw prices/volumes, delisted companies, corporate-event and settlement reconciliation, execution/cost parity and benchmark validation. Preserve later validation (2012–2016) and sealed test (2017–2025). No paper/live order activation follows from connecting the read-only API.

## References
- https://www.quantconnect.com/docs/v2/cloud-platform/api-reference/authentication
- https://www.quantconnect.com/docs/v2/cloud-platform/api-reference/backtest-management/list-backtests
