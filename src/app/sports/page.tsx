"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SPORTS = [
  ["nfl","NFL"],["nba","NBA"],["mlb","MLB"],["nhl","NHL"],["soccer","Soccer"],
  ["ncaaf","College Football"],["ncaab","College Basketball"],["tennis","Tennis"],["mma","MMA / UFC"],
] as const;
type Game = { id: string; home: string; away: string; startsAt: string; bookmakers: { sportsbook: string; selection: string; americanOdds: number; updatedAt: string }[] };
type Feed = { status: string; games: Game[]; fetchedAt?: string; message?: string; source?: string };
export default function SportsPage() {
  const [sport, setSport] = useState<string>("nba");
  const [feed, setFeed] = useState<Feed | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/sports?sport=${sport}`, { signal: controller.signal })
      .then(async r => { const data: Feed = await r.json(); if (!r.ok) throw new Error(data.message || "Feed unavailable"); return data; })
      .then(setFeed)
      .catch(e => { if (!controller.signal.aborted) setFeed({ status: "error", games: [], message: e.message }); });
    return () => controller.abort();
  }, [sport]);
  return (
    <main className="min-h-screen bg-[#101512] text-[#e9e9e2]">
      <div className="mx-auto max-w-6xl px-6 py-12 md:px-12">
        <Link href="/" className="text-xl font-semibold tracking-[-.06em]">sports<span className="text-[#c9df9a]">edge</span></Link>
        <div className="mt-14 border-b border-[#303b33] pb-10">
          <p className="font-mono text-xs uppercase tracking-[.2em] text-[#c9df9a]">Research / Sports AI</p>
          <h1 className="mt-5 text-5xl font-medium tracking-[-.07em] md:text-7xl">The sports desk.</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-[#a5b2a5]">Upcoming matchups and observed market prices. No model picks or performance claims until validated.</p>
        </div>
        <div className="my-8 flex flex-wrap gap-2" role="group" aria-label="Choose sport">
          {SPORTS.map(([id,name]) => <button key={id} onClick={() => {setSport(id);setFeed(null);}} aria-pressed={sport === id} className={`border px-4 py-2 text-xs transition-colors ${sport === id ? "border-[#c9df9a] bg-[#c9df9a] text-[#101512]" : "border-[#39483c] text-[#b8c3b5] hover:border-[#c9df9a]"}`}>{name}</button>)}
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-b border-[#303b33] pb-5 text-xs text-[#a5b2a5]">
          <span>{feed?.status === "live" ? "SOURCE / THE ODDS API" : "SOURCE / NOT ACTIVE"}</span>
          <span>{feed?.fetchedAt ? `Fetched ${new Date(feed.fetchedAt).toLocaleString()}` : "No verified update yet"}</span>
        </div>
        {!feed ? <p className="py-12 text-[#a5b2a5]">Loading feed…</p> :
         feed.status !== "live" ? <div className="py-12"><h2 className="text-xl">Live data unavailable</h2><p className="mt-3 text-sm text-[#a5b2a5]">{feed.message ?? "Provider connection required."}</p></div> :
         feed.games.length === 0 ? <p className="py-12 text-[#a5b2a5]">No upcoming games returned for this sport.</p> :
         <div>{feed.games.map(game => <article key={game.id} className="grid gap-5 border-b border-[#303b33] py-7 md:grid-cols-[1fr_1fr]">
           <div><div className="text-xs text-[#8fa08e]">{new Date(game.startsAt).toLocaleString()}</div><h2 className="mt-2 text-xl font-medium">{game.away} <span className="text-[#7f917f]">@</span> {game.home}</h2></div>
           <div>{game.bookmakers.length ? <div className="space-y-2">{game.bookmakers.slice(0,6).map((o,i) => <div key={i} className="flex justify-between gap-3 text-xs"><span className="text-[#a5b2a5]">{o.sportsbook} · {o.selection}</span><span className="font-mono">{o.americanOdds > 0 ? "+" : ""}{o.americanOdds}</span></div>)}</div> : <span className="text-xs text-[#8fa08e]">No available prices</span>}</div>
         </article>)}</div>}
        <p className="mt-12 border-l-2 border-[#c9df9a] pl-5 text-xs leading-6 text-[#9eac9e]">Prices are informational and may be delayed or unavailable. No bets are placed. No simulated earnings or model accuracy is implied.</p>
      </div>
    </main>
  );
}
