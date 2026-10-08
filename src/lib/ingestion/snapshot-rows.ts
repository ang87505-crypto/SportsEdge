/**
 * Pure database-boundary normalization for one provider's historical odds.
 * PostgreSQL enforces these same eight columns through odds_capture_dedupe_v1
 * (UNIQUE NULLS NOT DISTINCT), including the nullable "line" column.
 */
export const ODDS_CONFLICT_COLUMNS =
  "game_id,provider,sportsbook,market,selection,observed_at,american_odds,line";

export type CandidatePrice = {
  sportsbook: string;
  market: "h2h";
  selection: string;
  observedAt: string;
  americanOdds: number;
};
export type SnapshotInsert = {
  game_id: number;
  provider: "the_odds_api";
  sportsbook: string;
  market: "h2h";
  selection: string;
  observed_at: string;
  american_odds: number;
  line: null;
};

export function buildSnapshotRows(gameId: number, prices: readonly CandidatePrice[]): SnapshotInsert[] {
  if (!Number.isSafeInteger(gameId) || gameId <= 0) throw new Error("Invalid stored game ID");
  const unique = new Set<string>();
  const rows: SnapshotInsert[] = [];
  for (const price of prices) {
    if (!price || typeof price.sportsbook !== "string" || !price.sportsbook.trim()
      || typeof price.selection !== "string" || !price.selection.trim()
      || price.market !== "h2h" || !Number.isSafeInteger(price.americanOdds)
      || (price.americanOdds > -100 && price.americanOdds < 100)
      || typeof price.observedAt !== "string"
      || !Number.isFinite(Date.parse(price.observedAt))
      || new Date(price.observedAt).toISOString() !== price.observedAt) {
      throw new Error("Invalid odds snapshot record");
    }
    const row: SnapshotInsert = {
      game_id: gameId,
      provider: "the_odds_api",
      sportsbook: price.sportsbook,
      market: "h2h",
      selection: price.selection,
      observed_at: price.observedAt,
      american_odds: price.americanOdds,
      line: null,
    };
    const identity = JSON.stringify([
      row.game_id, row.provider, row.sportsbook, row.market, row.selection,
      row.observed_at, row.american_odds, row.line,
    ]);
    if (unique.has(identity)) continue;
    unique.add(identity);
    rows.push(row);
  }
  return rows;
}
