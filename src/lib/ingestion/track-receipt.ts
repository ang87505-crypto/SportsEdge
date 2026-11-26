/**
 * Per-sport outcome of one dual-track (NBA, EPL) moneyline collection, and the run-level status derived from it.
 * Pure: no clock, network or database. Each sport is judged on its own rows, so a fresh NBA save can never make a
 * failed or stale EPL track look refreshed (and vice versa).
 */
export type TrackOutcome =
  | "saved"        // rows inserted by this run and read back by their own IDs
  | "unchanged"    // prices offered, all already stored (identical provider last_update and price)
  | "empty_slate"  // the provider listed no upcoming fixtures for this sport
  | "no_prices"    // fixtures listed but no complete pregame h2h market
  | "store_failed" // a database write or read-back failed; rows may be partially written
  | "unverified";  // inserts reported, but this run's rows were not all found on read-back

export type TrackReceipt = {
  track: "nba" | "soccer";
  outcome: TrackOutcome;
  providerGames: number;        // upcoming fixtures after normalisation
  gamesStored: number;          // fixtures whose identity was written or found
  pricesOffered: number;        // complete pregame quotes offered by the provider
  oddsInserted: number;         // rows inserted by THIS run (PostgREST return=representation)
  oddsVerified: number;         // of those, rows read back by ID under this sport's fixtures
  newestSourceObservedAt: string | null; // newest provider market.last_update offered for this sport
  rejectedEvents: number;
  skippedLive: number;
  skippedMarkets: number;
  error?: "STORE_FAILED" | "VERIFY_FAILED";
};

export const OK_OUTCOMES: readonly TrackOutcome[] = ["saved", "unchanged", "empty_slate", "no_prices"];

export function classifyTrack(r: Omit<TrackReceipt, "outcome">): TrackOutcome {
  if (r.error === "STORE_FAILED" || r.error === "VERIFY_FAILED") return "store_failed";
  if (r.oddsInserted > 0) return r.oddsVerified === r.oddsInserted ? "saved" : "unverified";
  if (r.providerGames === 0) return "empty_slate";
  if (r.pricesOffered === 0) return "no_prices";
  return "unchanged";
}

export type RunStatus = "refreshed" | "no_new_quotes" | "partial_refresh" | "refresh_failed" | "refresh_unverified";

/** Run status from the per-sport receipts. Unknown report shapes are never treated as success. */
export function summarizeCollection(report: unknown): { status: RunStatus; tracks: Record<string, TrackOutcome> | null } {
  const tracks = (report as { tracks?: unknown } | null)?.tracks;
  if (!tracks || typeof tracks !== "object" || Array.isArray(tracks)) return { status: "refresh_unverified", tracks: null };
  const entries = Object.entries(tracks as Record<string, { outcome?: unknown }>);
  const known = new Set<string>(["saved", "unchanged", "empty_slate", "no_prices", "store_failed", "unverified"]);
  const names = entries.map(([k]) => k).sort().join(",");
  if (names !== "nba,soccer" || entries.some(([, t]) => typeof t?.outcome !== "string" || !known.has(t.outcome)))
    return { status: "refresh_unverified", tracks: null };
  const outcomes = Object.fromEntries(entries.map(([k, t]) => [k, t.outcome as TrackOutcome]));
  const values = Object.values(outcomes);
  const allOk = values.every(o => OK_OUTCOMES.includes(o));
  const anySaved = values.includes("saved");
  const status: RunStatus = allOk ? (anySaved ? "refreshed" : "no_new_quotes") : anySaved ? "partial_refresh" : "refresh_failed";
  return { status, tracks: outcomes };
}
