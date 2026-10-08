# SportsEdge data feeds — setup stage

The /sports page and /api/sports endpoint use The Odds API v4 when ODDS_API_KEY is configured.
No API keys are stored in GitHub. The API route does not expose the key to browsers.
When no key is configured, the page explicitly displays "Live data unavailable".
The API endpoint currently fetches live upcoming events and US-region h2h odds on demand; it does **not** persist records in Supabase or run scheduled collection. Cached responses target five minutes. API request quotas may apply.
Nine sports are listed. Soccer currently maps to MLS and tennis to the ATP French Open as examples, not comprehensive coverage; available sports vary seasonally and by plan.

## To activate
1. Create a free account at https://the-odds-api.com/ and obtain an API key.
2. Open Vercel > sports-edge > Settings > Environment Variables.
3. Add `ODDS_API_KEY` as a server-side environment variable (production).
4. Redeploy the project to make the variable available.
5. Visit https://sports-edge-eta.vercel.app/sports and verify the fetched timestamp and observed prices against the provider.

BALLDONTLIE_API_KEY is reserved for a separate future NBA statistics integration. Do not configure it until that feature is implemented.

## Next stage
Add secure Supabase server ingestion, historical snapshots, provider quotas/health monitoring, and scheduled jobs. Do not use the current live odds endpoint as evidence of backtest profitability.
