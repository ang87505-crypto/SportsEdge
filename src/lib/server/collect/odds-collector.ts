import "server-only";
import { TRACKS, normalizeOdds, oddsIdentity, type Track, type NormalizedPrice, type NormalizedGame } from "@/lib/ingestion/normalize";

const PROVIDER = "the_odds_api";
const MAX_GAMES_PER_TRACK = 80;
const MAX_PRICES_PER_GAME = 60;
const PAGE_SIZE = 1000;

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
  const response = await fetcher(
    `${config.base}/rest/v1/${table}${query.size ? "?" + query : ""}`, {
      method: "POST", headers: dbHeaders(config, {
        Prefer: `${options?.ignoreDuplicates ? "resolution=ignore-duplicates" : options?.onConflict ? "resolution=merge-duplicates" : "return=minimal"}, ${options?.returnRows ? "return=representation" : "return=minimal"}`,
      }),
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
  config: DbConfig, table: "leagues" | "teams" | "games",
  value: object, conflict: string, fetcher: Fetcher,
): Promise<number> {
  const rows = await postRows(config, table, [value], fetcher,
    { onConflict: conflict, returnRows: true });
  if (rows.length !== 1) throw new Error(`Expected exactly one ${table} row`);
  return rowId(rows[0]);
}

type StoredOdds = {
  sportsbook: string; market: string; selection: string;
  observed_at: string; american_odds: number; provider: string;
};

async function existingKeys(config: DbConfig, gameId: number, eventId: string, fetcher: Fetcher): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let offset = 0; offset <= 9_000; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      game_id: `eq.${gameId}`,
      provider: `eq.${PROVIDER}`,
      select: "sportsbook,market,selection,observed_at,american_odds,provider",
      order: "id.asc",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const rows = await getRows<StoredOdds>(config, `odds_snapshots?${params}`, fetcher);
    for (const row of rows) {
      const normalizedTime = new Date(row.observed_at).toISOString();
      keys.add(oddsIdentity(eventId, {
        sportsbook: row.sportsbook, market: "h2h", selection: row.selection,
        observedAt: normalizedTime, americanOdds: row.american_odds,
      }));
    }
    if (rows.length < PAGE_SIZE) return keys;
  }
  // Don't write without full duplicate visibility; later migration should
  // enforce database-level uniqueness for concurrent ingestion.
  throw new Error("Snapshot pagination safety limit exceeded");
}

function snapshotRows(gameId: number, eventId: string, prices: NormalizedPrice[], existing: Set<string>) {
  const next: object[] = [];
  for (const price of prices) {
    const key = oddsIdentity(eventId, price);
    if (existing.has(key)) continue;
    existing.add(key);
    next.push({
      game_id: gameId, provider: PROVIDER, sportsbook: price.sportsbook,
      market: price.market, selection: price.selection, line: null,
      american_odds: price.americanOdds, observed_at: price.observedAt,
    });
  }
  return next;
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
    const gameId = await upsertId(config, "games", {
      league_id: leagueId, provider: PROVIDER,
      provider_event_id: game.providerEventId,
      home_team_id: homeId, away_team_id: awayId,
      starts_at: game.startsAt,
    }, "provider,provider_event_id", fetcher);
    if (game.prices.length === 0) continue;

    const existing = await existingKeys(config, gameId, game.providerEventId, fetcher);
    const pending = snapshotRows(gameId, game.providerEventId, game.prices, existing);
    // Store source-observed snapshots append-only. The DB sets ingested_at independently.
    for (let i = 0; i < pending.length; i += 100) {
      await postRows(config, "odds_snapshots", pending.slice(i, i + 100), fetcher);
    }
    oddsSaved += pending.length;
  }
  return { gamesSaved: games.length, oddsSaved };
}

/**
 * Fetch both feeds successfully BEFORE any DB writes, so an API outage will
 * not leave one newly collected track written while the other was not fetched.
 *
 * A DB failure during writes may leave a partial run; re-running reconciles it.
 * Sequential deduplication is best-effort until a DB unique index is approved.
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
