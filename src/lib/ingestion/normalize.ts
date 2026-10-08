/**
 * Pure adapters for two independent modeling tracks.
 * No API tokens, database access, or wall-clock reads occur in this module.
 *
 * "observed_at" is the source market.last_update timestamp, while the database
 * stores its actual receipt time separately as ingested_at.
 */
export type Track = "nba" | "soccer";
export type TrackDefinition = {
  sportCode: "nba" | "soccer";
  leagueName: string;
  sourceSportKey: string;
  requiredOutcomes: 2 | 3;
};
export const TRACKS: Record<Track, TrackDefinition> = {
  nba: {
    sportCode: "nba",
    leagueName: "National Basketball Association",
    sourceSportKey: "basketball_nba",
    requiredOutcomes: 2,
  },
  soccer: {
    sportCode: "soccer",
    leagueName: "English Premier League",
    sourceSportKey: "soccer_epl",
    requiredOutcomes: 3,
  },
};

export type NormalizedPrice = {
  sportsbook: string;
  market: "h2h";
  selection: string;
  americanOdds: number;
  observedAt: string;
};
export type NormalizedGame = {
  providerEventId: string;
  startsAt: string;
  home: string;
  away: string;
  sourceUpdatedAt: string | null;
  prices: NormalizedPrice[];
};
export type NormalizationReport = {
  games: NormalizedGame[];
  invalidEvents: number;
  skippedMarkets: number;
  skippedLiveOrPast: number;
  collectedAt: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? new Date(ms).toISOString() : null;
}

function safeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const valueTrimmed = value.trim();
  return valueTrimmed.length > 0 && valueTrimmed.length <= 160 ? valueTrimmed : null;
}

function validOdds(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value)
    && (value <= -100 || value >= 100);
}

export function normalizeOdds(raw: unknown, track: Track, collectedAt: Date): NormalizationReport {
  if (!Array.isArray(raw)) throw new Error("The odds provider response must be an array");
  if (!Number.isFinite(collectedAt.getTime())) throw new Error("Invalid collection time");
  const definition = TRACKS[track];
  if (!definition) throw new Error("Unsupported collection track");
  const nowMs = collectedAt.getTime();
  const seenIds = new Set<string>();
  const games: NormalizedGame[] = [];
  let invalidEvents = 0, skippedMarkets = 0, skippedLiveOrPast = 0;

  for (const item of raw) {
    const event = record(item);
    if (!event) { invalidEvents++; continue; }
    const id = safeName(event.id);
    const startsAt = iso(event.commence_time);
    const home = safeName(event.home_team);
    const away = safeName(event.away_team);
    if (!id || !startsAt || !home || !away || home.toLowerCase() === away.toLowerCase()
        || event.sport_key !== definition.sourceSportKey || seenIds.has(id)) {
      invalidEvents++; continue;
    }
    seenIds.add(id);
    const startsMs = Date.parse(startsAt);
    // Never label live prices as pregame prices. No retrospective inference.
    if (startsMs <= nowMs) { skippedLiveOrPast++; continue; }
    const prices: NormalizedPrice[] = [];
    const books = Array.isArray(event.bookmakers) ? event.bookmakers : [];
    let newestUpdated: string | null = null;
    const unique = new Set<string>();

    for (const itemBook of books) {
      const book = record(itemBook);
      if (!book) continue;
      const sportsbook = safeName(book.key);
      if (!sportsbook || !Array.isArray(book.markets)) continue;
      for (const itemMarket of book.markets) {
        const market = record(itemMarket);
        if (!market || market.key !== "h2h") continue;
        const observedAt = iso(market.last_update);
        if (!observedAt || Date.parse(observedAt) > nowMs + 60_000 ||
            Date.parse(observedAt) >= startsMs || !Array.isArray(market.outcomes)) {
          skippedMarkets++; continue;
        }
        const required = definition.requiredOutcomes === 3
          ? [home, away, "Draw"] : [home, away];
        const outcomeMap = new Map<string, number>();
        let invalid = false;
        for (const candidate of market.outcomes) {
          const price = record(candidate);
          const label = price ? safeName(price.name) : null;
          if (!label || !price || !validOdds(price.price)) { invalid = true; break; }
          const lowerLabel = label.toLocaleLowerCase("en");
          if (outcomeMap.has(lowerLabel)) { invalid = true; break; }
          outcomeMap.set(lowerLabel, price.price);
        }
        if (invalid || outcomeMap.size !== required.length ||
            required.some(label => !outcomeMap.has(label.toLocaleLowerCase("en")))) {
          skippedMarkets++; continue;
        }
        for (const selection of required) {
          const actualPrice = outcomeMap.get(selection.toLocaleLowerCase("en"))!;
          const observation: NormalizedPrice = {
            sportsbook, market: "h2h", selection, americanOdds: actualPrice, observedAt,
          };
          const fingerprint = oddsIdentity(id, observation);
          if (unique.has(fingerprint)) continue;
          unique.add(fingerprint);
          prices.push(observation);
        }
        if (!newestUpdated || observedAt > newestUpdated) newestUpdated = observedAt;
      }
    }
    games.push({ providerEventId: id, startsAt, home, away,
      sourceUpdatedAt: newestUpdated, prices });
  }
  return {
    games, invalidEvents, skippedMarkets, skippedLiveOrPast,
    collectedAt: collectedAt.toISOString(),
  };
}

/** Stable identity prevents repeatedly storing an unchanged published price. */
export function oddsIdentity(eventId: string, price: NormalizedPrice): string {
  return JSON.stringify([
    eventId, price.sportsbook, price.market, price.selection,
    price.observedAt, price.americanOdds,
  ]);
}
