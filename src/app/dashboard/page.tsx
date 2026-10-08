"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const sports = [["nba","NBA"],["nfl","NFL"],["mlb","MLB"],["nhl","NHL"],["soccer","Soccer"],["ncaaf","NCAAF"],["ncaab","NCAAB"],["tennis","Tennis"],["mma","MMA"]] as const;
type Price = { sportsbook: string; selection: string; americanOdds: number; updatedAt: string };
type Game = { id: string; home: string; away: string; startsAt: string; bookmakers: Price[] };
type Feed = { status: string; games: Game[]; fetchedAt?: string; message?: string };
const formatOdds = (value: number) => value > 0 ? `+${value}` : String(value);
const panels = [
  { title: "Paper bankroll", value: "Not started", description: "Virtual accounts are not enabled", icon: "◈" },
  { title: "Model predictions", value: "Not trained", description: "No validated picks published", icon: "◎" },
  { title: "Historical results", value: "Collecting soon", description: "Results ingestion is pending", icon: "▤" },
  { title: "Stock research", value: "In development", description: "Watchlists and research tools", icon: "↗" },
];

export default function DashboardPage() {
  const [sport, setSport] = useState<string>("nba");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/sports?sport=${sport}`, { signal: controller.signal })
      .then(async response => {
        const result: Feed = await response.json();
        if (!response.ok) throw new Error(result.message || "Feed temporarily unavailable");
        return result;
      })
      .then(result => { if (!controller.signal.aborted) setFeed(result); })
      .catch(error => { if (!controller.signal.aborted) setFeed({ status: "error", games: [], message: String(error.message) }); });
    return () => controller.abort();
  }, [sport]);
  const live = feed?.status === "live";
  const cards = feed?.games ?? [];
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060e0c] text-[#eaf6ee] selection:bg-emerald-400 selection:text-black">
      <style jsx global>{`
        @keyframes edge-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes edge-glow { 0%,100% { opacity:.36; } 50% { opacity:.7; } }
        .edge-enter { animation: edge-rise .7s cubic-bezier(.2,.8,.2,1) both; }
        .edge-glass { background: linear-gradient(145deg,rgba(19,45,35,.67),rgba(8,22,18,.78)); border:1px solid rgba(133,210,160,.15); box-shadow: inset 0 1px rgba(219,255,229,.045), 0 20px 70px rgba(0,0,0,.14); backdrop-filter: blur(18px); }
        .edge-focus:focus-visible { outline:2px solid #69e6a0; outline-offset:3px; }
        @media (prefers-reduced-motion: reduce) { .edge-enter { animation:none; } .edge-motion { transition:none!important; animation:none!important; } }
      `}</style>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{background:"radial-gradient(ellipse 70% 35% at 78% -8%,rgba(19,133,73,.19),transparent),radial-gradient(ellipse 40% 40% at 0% 62%,rgba(19,99,62,.13),transparent)"}} />
      <div className="relative mx-auto flex min-h-screen max-w-[1700px]">
        <aside className={`${menu ? "flex absolute inset-y-0 left-0 z-30 w-72" : "hidden"} lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[252px] shrink-0 flex-col border-r border-emerald-100/10 bg-[#081411]/95 px-5 py-7 backdrop-blur-2xl`}>
          <div className="mb-12 flex items-center justify-between">
            <Link href="/" className="edge-focus text-[24px] font-bold tracking-[-.07em]">sports<span className="text-[#60e49a]">edge</span><span className="ml-1 align-top text-[9px] text-emerald-200/45">®</span></Link>
            <button className="edge-focus text-lg text-white/60 lg:hidden" aria-label="Close navigation" onClick={()=>setMenu(false)}>✕</button>
          </div>
          <div className="mb-3 px-3 font-mono text-[10px] tracking-[.18em] text-emerald-100/35">WORKSPACE</div>
          <nav aria-label="Main navigation" className="space-y-1 text-[13px]">
            <Link href="/dashboard" className="edge-focus flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-3 font-semibold text-[#80efaf]"><span className="text-lg">▦</span> Overview</Link>
            <Link href="/sports" className="edge-focus edge-motion flex items-center gap-3 rounded-xl px-3 py-3 text-white/65 transition hover:bg-white/5 hover:text-white"><span className="text-lg">◎</span> Sports AI <span className="ml-auto text-emerald-200/40">↗</span></Link>
            <div className="px-9 pb-3 text-[11px] leading-7 text-emerald-100/35">Live odds · Nine sports</div>
            {["Paper Betting","Stock Research","Paper Trading"].map(item=><div key={item} className="flex items-center justify-between rounded-xl px-3 py-3 text-white/45"><span>◌ &nbsp; {item}</span><span className="text-[9px] uppercase tracking-widest text-emerald-100/25">Soon</span></div>)}
          </nav>
          <div className="mt-auto rounded-2xl border border-emerald-300/10 bg-emerald-300/[.045] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#a8e8bd]"><span className="h-2 w-2 rounded-full bg-amber-300"/> Development workspace</div>
            <p className="text-xs leading-6 text-emerald-100/45">Verified data first. No invented picks, balances, or returns.</p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-5 pb-16 md:px-9 xl:px-12">
          <header className="flex h-20 items-center justify-between gap-4 border-b border-emerald-100/10">
            <div className="flex items-center gap-3">
              <button onClick={()=>setMenu(true)} className="edge-focus rounded-lg border border-white/10 px-3 py-2 text-white/75 lg:hidden" aria-label="Open navigation">☰</button>
              <span className="hidden font-mono text-[11px] uppercase tracking-[.2em] text-emerald-100/40 sm:block">Workspace / Overview</span>
              <Link href="/" className="text-xl font-bold tracking-tight lg:hidden">sports<span className="text-emerald-400">edge</span></Link>
            </div>
            <div className="flex items-center gap-3 rounded-full border border-emerald-200/10 bg-white/[.035] px-4 py-2 text-[11px]">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-400 shadow-[0_0_12px_#34d399]" : "bg-amber-300"}`}/>
              <span className="text-emerald-100/70">{live ? "Odds feed responding" : "Feed not verified"}</span>
            </div>
          </header>
          <section className="edge-enter relative mt-8 overflow-hidden rounded-[26px] border border-emerald-300/15 bg-gradient-to-br from-[#103023] via-[#0a1b16] to-[#08120f] px-7 py-10 md:px-11 md:py-12">
            <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-40 h-[440px] w-[440px] rounded-full bg-emerald-400/10 blur-[85px]"/>
            <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 h-[65%] w-[65%] opacity-40" style={{backgroundImage:"linear-gradient(rgba(112,219,145,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(112,219,145,.07) 1px,transparent 1px)",backgroundSize:"34px 34px",maskImage:"linear-gradient(to left,black,transparent)"}}/>
            <div className="relative max-w-[650px]">
              <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#8beab1]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/> SportsEdge intelligence platform</div>
              <h1 className="text-[clamp(2.4rem,5vw,4.6rem)] font-semibold leading-[1.05] tracking-[-.065em]">Sharper research.<br/><span className="text-[#8de3ad]">Better decisions.</span></h1>
              <p className="mt-5 max-w-xl text-[14px] leading-7 text-emerald-50/55">Explore observed sportsbook markets, build statistical models, and test ideas with a virtual bankroll. Evidence over hype.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/sports" className="edge-focus edge-motion rounded-xl bg-[#a5edb8] px-5 py-3 text-xs font-bold text-[#092115] transition hover:bg-[#d1f9dc] hover:-translate-y-0.5">Explore live odds ↗</Link>
                <a href="#markets" className="edge-focus edge-motion rounded-xl border border-emerald-200/20 bg-white/5 px-5 py-3 text-xs font-medium text-emerald-50/80 transition hover:bg-white/10">View market desk ↓</a>
              </div>
            </div>
          </section>
          <section aria-label="Platform metrics" className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            {panels.map((item,index)=><div key={item.title} className="edge-glass edge-enter edge-motion rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:border-emerald-300/30" style={{animationDelay:`${index*75}ms`}}>
              <div className="flex items-center justify-between text-xs text-emerald-50/50"><span>{item.title}</span><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-lg text-[#83e7a8]">{item.icon}</span></div>
              <div className="mt-3 text-[22px] font-semibold tracking-[-.04em]">{item.value}</div>
              <p className="mt-2 text-[11px] text-emerald-100/40">{item.description}</p>
            </div>)}
          </section>
          <section id="markets" className="mt-9">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.18em] text-[#6bdc9a]">Data desk / 01</div><h2 className="text-[25px] font-semibold tracking-[-.05em]">Market overview</h2></div><span className="text-[11px] text-emerald-100/40">{feed?.fetchedAt ? `Fetched ${new Date(feed.fetchedAt).toLocaleString()}` : "No verified fetch time"}</span></div>
            <div className="edge-glass overflow-hidden rounded-[22px]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100/10 px-5 py-5">
                <div className="flex flex-wrap gap-2">{sports.map(([id,label])=><button key={id} onClick={()=>{setSport(id);setFeed(null)}} aria-pressed={sport===id} className={`edge-focus edge-motion rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${sport===id?"border-emerald-300/40 bg-emerald-400/15 text-[#9aefb9]":"border-white/10 bg-white/[.025] text-emerald-100/45 hover:border-emerald-200/30 hover:text-white"}`}>{label}</button>)}</div>
                <Link href="/sports" className="edge-focus text-[11px] font-medium text-[#8ce9b0] hover:underline">Full sports desk ↗</Link>
              </div>
              <div className="hidden grid-cols-[1.4fr_.8fr_1fr] gap-4 border-b border-emerald-100/10 bg-white/[.025] px-6 py-3 font-mono text-[10px] uppercase tracking-[.13em] text-emerald-100/35 md:grid"><span>Matchup</span><span>Start time</span><span>Observed moneyline</span></div>
              {!feed ? <div className="p-10 text-sm text-emerald-100/50" role="status">Loading {sport.toUpperCase()} market data…</div> :
               !live ? <div className="p-10"><p className="text-base font-medium text-white/85">Market feed unavailable</p><p className="mt-2 text-xs leading-6 text-emerald-100/50">{feed.message ?? "Provider is not responding. Check your configuration."}</p></div> :
               cards.length===0 ? <div className="p-10 text-sm text-emerald-100/50">No upcoming events returned for this sport.</div> :
               <div>{cards.slice(0,8).map(game=><div key={game.id} className="edge-motion grid gap-3 border-b border-emerald-100/[.07] px-6 py-5 transition hover:bg-emerald-200/[.035] md:grid-cols-[1.4fr_.8fr_1fr] md:items-center md:gap-4">
                 <div><div className="mb-1 text-[10px] uppercase tracking-widest text-[#72ca95]">{sport.toUpperCase()}</div><div className="text-[13px] font-semibold">{game.away} <span className="text-emerald-100/35">at</span> {game.home}</div></div>
                 <div className="text-xs text-emerald-100/55">{new Date(game.startsAt).toLocaleString()}</div>
                 <div>{game.bookmakers.length ? <div className="space-y-1">{game.bookmakers.slice(0,2).map((price,index)=><div key={index} className="flex justify-between gap-3 text-[11px]"><span className="truncate text-emerald-100/55">{price.sportsbook} · {price.selection}</span><span className="shrink-0 font-mono font-semibold text-[#98edb7]">{formatOdds(price.americanOdds)}</span></div>)}</div> : <span className="text-[11px] text-emerald-100/35">No prices returned</span>}</div>
               </div>)}</div>}
              <div className="border-t border-emerald-100/10 bg-black/10 px-6 py-4 text-[11px] leading-5 text-emerald-100/40">Source: The Odds API, when connected. Prices may change or be delayed. No picks, profits, or bankroll balances are fabricated.</div>
            </div>
          </section>
          <section className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="edge-glass rounded-[22px] p-7"><div className="mb-5 flex items-center justify-between"><h3 className="text-base font-semibold tracking-tight">Prediction models</h3><span className="rounded-full border border-amber-300/20 bg-amber-300/5 px-3 py-1 text-[10px] text-amber-200/70">Not trained</span></div><p className="text-[13px] leading-7 text-emerald-100/50">Probability evaluation, no-vig calculations, and historical validation code exist. Verified model predictions will appear after real training and backtesting.</p><div className="mt-6 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-700 to-emerald-300"/></div><p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-emerald-100/30">Research infrastructure / in progress</p></div>
            <div className="edge-glass rounded-[22px] p-7"><div className="mb-5 flex items-center justify-between"><h3 className="text-base font-semibold tracking-tight">Paper betting</h3><span className="rounded-full border border-emerald-200/15 px-3 py-1 text-[10px] text-emerald-100/45">Coming soon</span></div><p className="text-[13px] leading-7 text-emerald-100/50">A separate virtual bankroll will track simulated bets, units, wins, losses, and ROI after secure accounts and settlement are implemented.</p><div className="mt-6 flex gap-2">{["Virtual only","No real-money bets","Auditable results"].map(tag=><span key={tag} className="rounded-lg bg-white/[.045] px-3 py-2 text-[10px] text-emerald-100/50">{tag}</span>)}</div></div>
          </section>
          <footer className="mt-12 flex flex-wrap justify-between gap-4 border-t border-emerald-100/10 pt-6 text-[10px] uppercase tracking-[.15em] text-emerald-100/30"><span>SportsEdge © 2026</span><span>Research first. Risk aware.</span></footer>
        </main>
      </div>
    </div>
  );
}
