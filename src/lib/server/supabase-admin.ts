import "server-only";

/**
 * Minimal server-side Supabase REST adapter.
 * Never import from a client component or expose service role credentials.
 */
function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration missing");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("Invalid Supabase project URL");
  }
  return { base: parsed.origin, key };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function readSportsConnection(): Promise<{ connected: true; sportsCount: number }> {
  const { base, key } = config();
  const response = await fetch(`${base}/rest/v1/sports?select=code`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Supabase connection check failed: HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || !rows.every(row => row && typeof row === "object" && typeof row.code === "string")) {
    throw new Error("Unexpected Supabase response");
  }
  return { connected: true, sportsCount: rows.length };
}
