import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const SPORTS: Record<string, string> = {
  nfl: "americanfootball_nfl", nba: "basketball_nba", mlb: "baseball_mlb",
  nhl: "icehockey_nhl", ncaaf: "americanfootball_ncaaf", ncaab: "basketball_ncaab",
  soccer: "soccer_usa_mls", tennis: "tennis_atp_french_open", mma: "mma_mixed_martial_arts",
};
type Outcome = { name: string; price: number; point?: number };
type Market = { key: string; outcomes: Outcome[] };
type Bookmaker = { title: string; last_update: string; markets: Market[] };
type Event = { id: string; home_team: string; away_team: string; commence_time: string; bookmakers: Bookmaker[] };
export async function GET(request: Request) {
  const sport = new URL(request.url).searchParams.get("sport") ?? "nba";
  if (!Object.hasOwn(SPORTS, sport)) return NextResponse.json({ error: "Unsupported sport" }, { status: 400 });
  const key = process.env.ODDS_API_KEY;
  if (!key) return NextResponse.json({ status: "not_configured", sport, games: [], message: "Live odds provider is not configured." });
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${SPORTS[sport]}/odds/`);
  url.searchParams.set("apiKey", key);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");
  try {
    const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return NextResponse.json({ status: "provider_error", sport, games: [], message: "Sports feed temporarily unavailable.", fetchedAt: new Date().toISOString() }, { status: 503 });
    }
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) throw new Error("Invalid provider response");
    const games = (raw as Event[]).filter(e => typeof e.id === "string" && typeof e.commence_time === "string" && typeof e.home_team === "string" && typeof e.away_team === "string").slice(0, 30).map(e => ({
      id: e.id, home: e.home_team, away: e.away_team, startsAt: e.commence_time,
      bookmakers: (Array.isArray(e.bookmakers) ? e.bookmakers : []).slice(0, 8).flatMap(b =>
        (Array.isArray(b.markets) ? b.markets : []).filter(m => m.key === "h2h").flatMap(m =>
          (Array.isArray(m.outcomes) ? m.outcomes : []).filter(o => typeof o.price === "number" && typeof o.name === "string").map(o => ({
            sportsbook: b.title, selection: o.name, americanOdds: o.price, updatedAt: b.last_update,
          }))
        )
      ),
    }));
    return NextResponse.json({ status: "live", sport, games, fetchedAt: new Date().toISOString(), source: "The Odds API" }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ status: "provider_error", sport, games: [], message: "Sports feed temporarily unavailable." }, { status: 503 });
  }
}
