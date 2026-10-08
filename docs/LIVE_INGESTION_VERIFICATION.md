# SportsEdge live data ingestion — controlled verification

## Verified starting state (October 8, 2026)

Vercel metadata contains four Production variables:
`ODDS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SPORTSEDGE_INGEST_TOKEN`. Both keys and the ingestion token are **sensitive**, and values were neither requested nor displayed. Vercel Production deployment is READY. Supabase's seven existing tables were inspected: 9 sports, 0 leagues/teams/games/odds snapshots/predictions/paper bets.

**Important:** Metadata does not prove an authenticated connection. The assistant's Vercel connector received HTTP 403 when attempting to fetch deployment content and function logs, and could not safely invoke the authorized route (token value is deliberately inaccessible).

## New read-only connection check

The private `GET /api/internal/collect-markets?probe=1` response, when called with `Authorization: Bearer <private-token>`:

- Checks the existing token first, rejecting unauthorized requests with 404.
- Checks private environment presence without exposing values.
- Uses the Supabase project's `sports?select=code&limit=50` REST endpoint, with server-only privileged credentials.
- Verifies at least one nonduplicate lowercase sport code; responds with a small `{"status":"connected","sportsCount":9}` payload on success.
- Does **not** contact The Odds API or write any data. A failed DB check returns a generic 503.

Production still requires a successful authorized smoke test to claim database access is working.

## Windows PowerShell 5.1+ test (owner runs locally)

New script: `scripts/check-and-collect.ps1`. It uses `Read-Host -AsSecureString` to keep the token out of the command-line history and avoids echoing/recording it.

From the SportsEdge repository folder:

```powershell
powershell -NoProfile -File .\scripts\check-and-collect.ps1
```

This defaults to a **read-only probe**. Only after it confirms connection, explicitly choose to consume Odds API credits and collect genuine upcoming NBA/EPL games with:

```powershell
powershell -NoProfile -File .\scripts\check-and-collect.ps1 -Collect
```

The script will ask for the locally saved `SPORTSEDGE_INGEST_TOKEN`. Do not paste the token into ChatGPT, code, GitHub, logs, or screenshots. Check that the site URL is the official project alias. If 404, verify token and environment redeploy. If 503, inspect own Vercel logs privately without sharing secrets.

## DB verification without fabricated production data

After a successful collection, use Supabase read-only SQL:

```sql
select l.sport_code, l.provider_league_id, count(distinct g.id) as games,
       count(o.id) as stored_prices, min(o.observed_at) as first_observation,
       max(o.observed_at) as last_observation
from public.leagues l
left join public.games g on g.league_id = l.id
left join public.odds_snapshots o on o.game_id = g.id
group by l.sport_code, l.provider_league_id
order by l.sport_code, l.provider_league_id;
```

Verify correct league, price completeness, source timestamps strictly before kickoff, and observations were ingested with valid provider IDs. Retry collection at most when provider quota permits; snapshots with unchanged source timestamp/price should not duplicate thanks to `odds_capture_dedupe_v1`.

## Remaining limitations

- A successful probe verifies only Supabase reads; the manual collector run is needed to validate writes.
- The 579-match Elo backtest is soccer research, not independently archived forward NBA forecasts.
- A concurrent collector can consume provider quota twice even though the database ignores duplicates; add a single-flight lease before cron.
- No scheduled collection, final-scores source, live odds-to-model pipeline, or production ROI tracking is verified yet.
- Never mark ingestion as automatically active until runtime verification and responsible scheduling.
