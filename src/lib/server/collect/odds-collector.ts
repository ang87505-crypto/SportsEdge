import "server-only";
import { collectDualTracksWith, type DbConfig } from "./dual-track-core.ts";

type Fetcher = typeof fetch;

function configuredDb(): DbConfig {
  const address = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!address || !key) throw new Error("Supabase server credentials are not configured");
  const url = new URL(address);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid Supabase project URL");
  }
  if (!key.startsWith("sb_secret_") && !key.startsWith("eyJ")) {
    throw new Error("Use a Supabase secret key or a legacy service-role key");
  }
  return { base: url.origin, key };
}

/** Server entry point: production credentials from the environment, then the tested core. */
export async function collectDualTracks(fetcher: Fetcher = fetch) {
  const config = configuredDb();
  const oddsKey = process.env.ODDS_API_KEY;
  if (!oddsKey) throw new Error("ODDS_API_KEY is missing");
  return collectDualTracksWith(config, oddsKey, fetcher, new Date());
}
