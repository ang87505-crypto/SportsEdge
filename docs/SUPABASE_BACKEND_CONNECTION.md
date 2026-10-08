# Server-only Supabase connection — milestone 3 (pending verification)

Files added: `src/lib/server/supabase-admin.ts` and `src/app/api/internal/data-health/route.ts`.
No existing code, tables, or policies changed. No data has been ingested.

## Configuration
In Vercel project `sports-edge`, add **server-side** environment variables:
- `SUPABASE_URL`: your Supabase Project URL, from Supabase > Project Settings > Data API.
- `SUPABASE_SERVICE_ROLE_KEY`: privileged key from Supabase > Project Settings > API Keys (legacy service_role secret or appropriate server secret).
- `SPORTSEDGE_HEALTH_TOKEN`: a random, private long string for protecting the connection-check endpoint.

Never put these values in GitHub, browser code, `NEXT_PUBLIC_*` variables, or chat. Keep the service-role key out of client code. This key bypasses row-level security. Redeploy after adding environment variables.

## Verification
After deployment, an authorized backend request to `/api/internal/data-health` with `Authorization: Bearer <SPORTSEDGE_HEALTH_TOKEN>` should return `{"status":"connected","sportsCount":9}` if configuration and access are correct. Unauthorized calls intentionally return 404. Do not share the health token.

**Current status:** code committed but not built, deployed, or integration-tested. Do not claim Supabase is connected until an authorized health check succeeds.

## Next
Implement idempotent ingestion in a separate milestone after connection verification. Add provider quota controls, append-only odds snapshots, and event reconciliation. Do not create publicly callable privileged ingestion endpoints.
