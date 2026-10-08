import "server-only";
import { countValidSports } from "@/lib/ingestion/readiness";

/**
 * A read-only, credential-protected smoke test. Uses the same server-only
 * configuration style as the collector; does not use Odds API or insert rows.
 */
export async function checkIngestionDatabase(fetcher: typeof fetch = fetch): Promise<{ status: "connected"; sportsCount: number }> {
  const input = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!input || !secret) throw new Error("Supabase server configuration missing");
  const url = new URL(input);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") ||
    url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid Supabase project URL");
  if (!secret.startsWith("sb_secret_") && !secret.startsWith("eyJ")) {
    throw new Error("Invalid Supabase server key type");
  }
  const response = await fetcher(`${url.origin}/rest/v1/sports?select=code&limit=50`, {
    headers: {
      apikey: secret,
      ...(secret.startsWith("eyJ") ? { Authorization: `Bearer ${secret}` } : {}),
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Supabase connection probe HTTP ${response.status}`);
  const raw: unknown = await response.json();
  return { status: "connected", sportsCount: countValidSports(raw) };
}
