import "server-only";
import { TRACKS, normalizeOdds, type Track, type NormalizedGame } from "@/lib/ingestion/normalize";
import { buildSnapshotRows, ODDS_CONFLICT_COLUMNS } from "@/lib/ingestion/snapshot-rows";

const PROVIDER = "the_odds_api";
const MAX_GAMES_PER_TRACK = 80;
const MAX_PRICES_PER_GAME = 60;

type Fetcher = typeof fetch;
type DbConfig = { base: string; key: string };

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

function dbHeaders(config: DbConfig, extra: Record<string, string> = {}): HeadersInit {
  // New Supabase sb_secret_ keys belong in apikey, not Authorization: Bearer.
  return {
    apikey: config.key,
    ...(config.key.startsWith("eyJ") ? { Authorization: `Bearer ${config.key}` } : {}),
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extra,
  };
}

async function getRows<T>(config: DbConfig, resource: string, fetcher: Fetcher): Promise<T[]> {
  const response = await fetcher(`${config.base}/rest/v1/${resource}`, {
    headers: dbHeaders(config), cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Supabase read failed (HTTP ${response.status})`);
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) throw new Error("Supabase read returned a non-array result");
  return raw as T[];
}

async function postRows<T>(
  config: DbConfig, table: string, rows: object[], fetcher: Fetcher,
  options?: { onConflict?: string; returnRows?: boolean; ignoreDuplicates?: boolean },
): Promise<T[]> {
  if (rows.length === 0) return [];
  const query = new URLSearchParams();
  if (options?.onConflict) query.set("on_conflict", options.onConflict);
  if (options?.returnRows) query.set("select", "id");
  const preference = [
    options?.ignoreDuplicates ? "resolution=ignore-duplicates" :
      options?.onConflict ? "resolution=merge-duplicates" : null,
    "missing=default",
    options?.returnRows ? "return=representation" : "return=minimal",
  ].filter(Boolean).join(",");
  const response = await fetcher(
    `${config.base}/rest/v1/${table}${query.size ? "?" + query : ""}`, {
      method: "POST", headers: dbHeaders(config, { Prefer: preference }),
      body: JSON.stringify(rows), cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`Supabase write to ${table} failed (HTTP ${response.status})`);
  if (!options?.returnRows) return [];
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) throw new Error(`Supabase ${table} write returned invalid data`);
  return raw as T[];
}

function rowId(raw: unknown): number {
  if (!raw || typeof raw !== "object") throw new Error("Supabase did not return an ID");
  const value = (raw as { id?: unknown }).id;
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(num) || num <= 0) throw new Error("Invalid Supabase row ID");
  return num;
}

async function upsertId(
  config: DbConfig, table: "leagues" | "teams",
  value: object, conflict: string, fetcher: Fetcher,
): Promise<number> {
  const rows = await postRows(config, table, [value], fetcher,
    { onConflict: conflict, returnRows: true });
  if (rows.length !== 1) throw new Error(`Expected exactly one ${table} row`);
  return rowId(rows[0]);
}

async function getOrCreateGame(
  config: DbConfig, value: {
    league_id: number; provider: string; provider_event_id: string;
    home_team_id: number; away_team_id: number; starts_at: string; status: "scheduled";
  }, fetcher: Fetcher,
): Promise<number> {
  const query = new URLSearchParams({
    select: "id", provider: `eq.${value.provider}`,
    provider_event_id: `eq.${value.provider_event_id}`, limit: "1",
  });
  const path = `games?${query}`;
  const existing = await getRows<{ id: number | string }>(config, path, fetcher);
  if (existing.length) return rowId(existing[0]);
  // On conflict DO NOTHING; do NOT upsert "scheduled" over previously final games.
  const inserted = await postRows<{ id: number | string }>(
    config, "games", [value], fetcher,
    { onConflict: "provider,provider_event_id", ignoreDuplicates: true, returnRows: true },
  );
  if (inserted.length === 1) return rowId(inserted[0]);
  // A concurrent writer may have inserted the game first.
  const found = await getRows<{ id: number | string }>(config, path, fetcher);
  if (found.length !== 1) throw new Error("Could not resolve stored game identity");
  return rowId(found[0]);
}

async function fetchMarket(track: Track, oddsApiKey: string, fetcher: Fetcher, time: Date) {
  const source = TRACKS[track].sourceSportKey;
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${source}/odds/`);
  url.searchParams.set("apiKey", oddsApiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");
  const response = await fetcher(url, {
    cache: "no-store", signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`The Odds API ${track} request failed (HTTP ${response.status})`);
  const raw: unknown = await response.json();
  const report = normalizeOdds(raw, track, time);
  if (report.games.length > MAX_GAMES_PER_TRACK ||
      report.games.some(game => game.prices.length > MAX_PRICES_PER_GAME)) {
    throw new Error("Provider payload exceeds collection safety limit");
  }
  const remainingHeader = response.headers.get("x-requests-remaining");
  const remaining = remainingHeader === null ? null : Number(remainingHeader);
  return { report, remaining: Number.isInteger(remaining) && remaining !== null ? remaining : null };
}

async function storeTrack(
  config: DbConfig, track: Track, games: NormalizedGame[], fetcher: Fetcher,
): Promise<{ gamesSaved: number; oddsSaved: number }> {
  const definition = TRACKS[track];
  const leagueId = await upsertId(config, "leagues", {
    sport_code: definition.sportCode, provider: PROVIDER,
    provider_league_id: definition.sourceSportKey, name: definition.leagueName,
  }, "provider,provider_league_id", fetcher);
  const savedTeams = new Map<string, number>();
  async function team(name: string) {
    const prior = savedTeams.get(name);
    if (prior !== undefined) return prior;
    const id = await upsertId(config, "teams", {
      league_id: leagueId, provider: PROVIDER,
      provider_team_id: `${definition.sourceSportKey}:${name}`, name,
    }, "provider,provider_team_id", fetcher);
    savedTeams.set(name, id);
    return id;
  }

  let oddsSaved = 0;
  for (const game of games) {
    // Upsert game identity; do not alter any stored final scores.
    const homeId = await team(game.home);
    const awayId = await team(game.away);
    const gameId = await getOrCreateGame(config, {
      league_id: leagueId, provider: PROVIDER,
      provider_event_id: game.providerEventId,
      home_team_id: homeId, away_team_id: awayId,
      starts_at: game.startsAt, status: "scheduled",
    }, fetcher);
    if (game.prices.length === 0) continue;

    const pending = buildSnapshotRows(gameId, game.prices);
    // Append-only, atomic ON CONFLICT DO NOTHING backed by the DB's verified
    // NULLS NOT DISTINCT uniqueness constraint. "return=representation"
    // accurately counts only rows inserted, including concurrent invocations.
    for (let i = 0; i < pending.length; i += 100) {
      const inserted = await postRows<{ id: number | string }>(
        config, "odds_snapshots", pending.slice(i, i + 100), fetcher, {
          onConflict: ODDS_CONFLICT_COLUMNS,
          ignoreDuplicates: true,
          returnRows: true,
        },
      );
      oddsSaved += inserted.length;
    }
  }
  return { gamesSaved: games.length, oddsSaved };
}

/**
 * Fetch both feeds successfully BEFORE any DB writes, so an API outage will
 * not leave one newly collected track written while the other was not fetched.
 *
 * A DB failure during writes may leave a partial run; a retry reconciles it.
 * Database-level uniqueness prevents duplicate odds rows even under concurrent
 * invocations. It does not limit duplicate external API calls or provider quota.
 */
export async function collectDualTracks(fetcher: Fetcher = fetch) {
  const config = configuredDb();
  const oddsKey = process.env.ODDS_API_KEY;
  if (!oddsKey) throw new Error("ODDS_API_KEY is missing");
  const at = new Date();
  const nba = await fetchMarket("nba", oddsKey, fetcher, at);
  if (nba.remaining !== null && nba.remaining < 1) throw new Error("Odds API quota too low for soccer request");
  const soccer = await fetchMarket("soccer", oddsKey, fetcher, at);
  const nbaResult = await storeTrack(config, "nba", nba.report.games, fetcher);
  const soccerResult = await storeTrack(config, "soccer", soccer.report.games, fetcher);
  return {
    status: "completed",
    capturedAt: at.toISOString(),
    tracks: {
      nba: { ...nbaResult, rejectedEvents: nba.report.invalidEvents, skippedLive: nba.report.skippedLiveOrPast,
        skippedMarkets: nba.report.skippedMarkets },
      soccer: { ...soccerResult, rejectedEvents: soccer.report.invalidEvents, skippedLive: soccer.report.skippedLiveOrPast,
        skippedMarkets: soccer.report.skippedMarkets },
    },
    quotaRemaining: soccer.remaining,
  };
}
