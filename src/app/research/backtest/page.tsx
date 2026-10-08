"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import audit from "@/data/research/elo_2026_10_08.json";

type League = "all" | "en" | "de" | "es" | "it" | "fr";
type Match = (typeof audit.games)[number];
const LEAGUES: { id: League; name: string }[] = [
  { id: "all", name: "All leagues" }, { id: "en", name: "Premier League" },
  { id: "de", name: "Bundesliga" }, { id: "es", name: "La Liga" },
  { id: "it", name: "Serie A" }, { id: "fr", name: "Ligue 1" },
];
const outcomeLabel = (code: string) => code === "H" ? "Home" : code === "D" ? "Draw" : "Away";
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const fixed = (n: number) => n.toFixed(3);
const PAGE = 25;

export default function HistoricalBacktestPage() {
  const [league, setLeague] = useState<League>("all");
  const [onlyMisses, setOnlyMisses] = useState(false);
  const [page, setPage] = useState(0);
  const current = league === "all" ? audit.overall : audit.leagues[league];
  const filtered = useMemo(
    () => (audit.games as Match[]).filter(row => (league === "all" || row.league === league) && (!onlyMisses || !row.correct)),
    [league, onlyMisses],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <main className="min-h-screen overflow-hidden bg-[#06100d] text-[#e8f5ed] selection:bg-emerald-300 selection:text-[#06100d]">
      <style jsx global>{`
      @keyframes research-show { from { opacity:0; transform: translateY(15px) } to { opacity:1; transform:translateY(0) } }
      .research-glass { background:linear-gradient(138deg,rgba(21,55,39,.69),rgba(8,24,18,.84)); border:1px solid rgba(128,221,159,.15); box-shadow:inset 0 1px rgba(255,255,255,.045),0 12px 50px rgba(0,0,0,.14);backdrop-filter:blur(15px) }
      .research-arrive {animation:research-show .55s ease-out both}
      @media(prefers-reduced-motion:reduce){.research-arrive{animation:none}}
      `}</style>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0" style={{background:"radial-gradient(ellipse 70% 35% at 75% -10%,rgba(34,150,82,.19),transparent),radial-gradient(ellipse 45% 30% at -10% 60%,rgba(25,91,65,.12),transparent)"}} />
      <div className="relative mx-auto max-w-[1360px] px-5 pb-20 pt-7 md:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-7">
          <Link href="/dashboard" className="text-2xl font-bold tracking-[-.07em] focus-visible:outline-2 focus-visible:outline-emerald-400">sports<span className="text-[#62e49a]">edge</span></Link>
          <nav aria-label="Research navigation" className="flex flex-wrap items-center gap-5 text-xs text-emerald-100/55">
            <Link href="/dashboard" className="hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-400">Dashboard</Link>
            <Link href="/sports" className="hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-400">Sports desk</Link>
            <span aria-current="page" className="text-[#97eab5]">Backtest research</span>
          </nav>
        </header>
        <section className="research-arrive relative overflow-hidden rounded-[28px] border border-emerald-300/15 bg-gradient-to-br from-[#143b28]/85 via-[#0b2018] to-[#081510] px-6 py-11 md:mt-8 md:px-12 md:py-14">
          <div aria-hidden="true" className="absolute -right-20 -top-36 h-96 w-96 rounded-full bg-emerald-300/10 blur-[90px]" />
          <div className="relative">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-200/15 bg-amber-100/[.06] px-3 py-2 font-mono text-[10px] uppercase tracking-[.16em] text-amber-100/75"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Retrospective research · not live picks</div>
            <p className="font-mono text-xs uppercase tracking-[.2em] text-[#8ce5ae]">Research / Model validation / 01</p>
            <h1 className="mt-4 max-w-4xl text-[clamp(2.2rem,5.5vw,5rem)] font-semibold leading-[1.06] tracking-[-.066em]">Predictions, <span className="text-[#94e6b3]">tested against reality.</span></h1>
            <p className="mt-5 max-w-2xl text-[14px] leading-7 text-emerald-50/55">Reconstructed pregame probabilities from an Elo baseline, compared with recorded home wins, draws, and away wins. Every evaluated match is available below.</p>
            <div className="mt-6 flex flex-wrap gap-3 font-mono text-[11px] text-emerald-100/55"><span>WINDOW / APR 08 – OCT 07 2026</span><span className="text-emerald-200/25">•</span><span>DATA THROUGH / SEP 20 2026</span><span className="text-emerald-200/25">•</span><span>CC0 DATASET</span></div>
          </div>
        </section>
        <section aria-label="Backtest metrics" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "Evaluated matches", value: String(current.games), caption: league === "all" ? "Five European leagues" : audit.leagues[league].label },
            { title: "Outcome accuracy", value: percent(current.accuracy), caption: `Simple baseline: ${percent(current.baselineAccuracy)}` },
            { title: "Log loss", value: fixed(current.logLoss), caption: `Simple baseline: ${fixed(current.baselineLogLoss)}` },
            { title: "Three-class Brier", value: fixed(current.brier), caption: `Simple baseline: ${fixed(current.baselineBrier)}` },
          ].map(item=><div key={item.title} className="research-glass rounded-2xl px-6 py-6">
            <p className="font-mono text-[10px] uppercase tracking-[.1em] text-emerald-50/40">{item.title}</p>
            <p className="mt-3 text-[31px] font-semibold tracking-[-.055em] text-[#f0f9f2]">{item.value}</p>
            <p className="mt-2 text-xs text-emerald-100/50">{item.caption}</p>
          </div>)}
        </section>
        <section className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <div className="research-glass rounded-[22px] p-6 md:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold tracking-tight">Accuracy by league</h2><span className="text-[10px] uppercase tracking-widest text-emerald-100/35">Higher is better</span></div>
            <div className="space-y-5">{LEAGUES.filter(l=>l.id!=="all").map(l=>{const metrics=audit.leagues[l.id as keyof typeof audit.leagues];return <div key={l.id}>
              <div className="mb-2 flex justify-between gap-2 text-xs"><span className="text-white/85">{l.name} <span className="text-emerald-100/35">· {metrics.games} games</span></span><span className="font-mono text-[#9beabb]">{percent(metrics.accuracy)}</span></div>
              <div className="relative h-2 overflow-hidden rounded-full bg-white/[.075]"><div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-700 to-[#8ae3a8]" style={{width:`${metrics.accuracy*100}%`}} /></div>
            </div>})}</div>
          </div>
          <div className="research-glass rounded-[22px] p-6 md:p-8">
            <h2 className="text-xl font-semibold tracking-tight">What these numbers mean</h2>
            <div className="mt-5 space-y-5 text-[13px] leading-6 text-emerald-100/55">
              <p><strong className="text-emerald-50">Accuracy</strong> means the most probable of home, draw, or away matched the recorded outcome.</p>
              <p><strong className="text-emerald-50">Log loss and Brier</strong> evaluate the quality of probabilities, not just correct picks. Lower values are better.</p>
              <p><strong className="text-emerald-50">The baseline</strong> always uses historical home/draw/away frequencies measured before the test window.</p>
              <p><strong className="text-emerald-50">ROI unavailable:</strong> no timestamped, licensed historical sportsbook prices were used. This is not a claim of betting profitability.</p>
            </div>
          </div>
        </section>
        <section className="mt-9">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#86e6aa]">Audit trail / 02</p><h2 className="text-[25px] font-semibold tracking-tight">Predicted vs. actual</h2></div><div className="text-[11px] text-emerald-100/40">{filtered.length} matching games</div></div>
          <div className="research-glass overflow-hidden rounded-[22px]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-100/10 px-5 py-5">
              <div className="flex flex-wrap gap-2" aria-label="League filter">{LEAGUES.map(l=><button key={l.id} type="button" aria-pressed={league===l.id} onClick={()=>{setLeague(l.id);setPage(0)}} className={`rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400 ${league===l.id?"border-emerald-300/30 bg-emerald-300/15 text-emerald-100":"border-emerald-100/10 bg-white/[.03] text-emerald-100/55 hover:bg-white/[.08]"}`}>{l.name}</button>)}</div>
              <label className="flex items-center gap-2 text-xs text-emerald-100/65"><input type="checkbox" checked={onlyMisses} onChange={e=>{setOnlyMisses(e.target.checked);setPage(0)}} className="accent-emerald-400"/> Show mistakes only</label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-left text-xs">
                <thead><tr className="border-b border-emerald-100/10 bg-white/[.025] font-mono text-[10px] uppercase tracking-[.12em] text-emerald-100/40"><th className="px-5 py-4 font-normal">Date</th><th className="px-5 py-4 font-normal">Match</th><th className="px-5 py-4 font-normal">Model probabilities H / D / A</th><th className="px-5 py-4 font-normal">Predicted</th><th className="px-5 py-4 font-normal">Final result</th><th className="px-5 py-4 font-normal">Outcome</th></tr></thead>
                <tbody>{rows.map((game,i)=><tr key={`${game.date}-${game.league}-${game.home}-${game.away}-${i}`} className="border-b border-emerald-100/[.07] transition-colors hover:bg-white/[.035]">
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-emerald-100/40">{game.date}</td>
                  <td className="px-5 py-4"><p className="font-semibold text-emerald-50/85">{game.home} · {game.away}</p><p className="mt-1 text-[10px] text-emerald-100/35">{audit.leagues[game.league as keyof typeof audit.leagues].label}</p></td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-emerald-100/65">{game.probabilities.map(percent).join(" / ")}</td>
                  <td className="px-5 py-4 text-emerald-50/75">{outcomeLabel(game.prediction)}</td>
                  <td className="px-5 py-4 font-mono"><span className="font-semibold text-white">{game.score.join("–")}</span><span className="ml-2 text-emerald-100/45">{outcomeLabel(game.actual)}</span></td>
                  <td className="px-5 py-4"><span className={`rounded-md border px-2 py-1 text-[10px] ${game.correct?"border-emerald-300/20 bg-emerald-300/10 text-[#9ae9b7]":"border-rose-300/20 bg-rose-300/[.07] text-rose-200/80"}`}>{game.correct?"Correct":"Missed"}</span></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-xs text-emerald-100/50">
              <span>Showing {filtered.length===0?0:page*PAGE+1}–{Math.min((page+1)*PAGE,filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-3"><button type="button" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))} className="rounded-lg border border-emerald-200/15 px-4 py-2 text-white/65 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30">Previous</button><span>{page+1} / {totalPages}</span><button type="button" disabled={page+1>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} className="rounded-lg border border-emerald-200/15 px-4 py-2 text-white/65 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30">Next</button></div>
            </div>
          </div>
        </section>
        <section className="mt-7 rounded-[22px] border border-amber-300/15 bg-amber-300/[.045] p-6 md:p-8">
          <h2 className="text-base font-semibold text-amber-100">Methodology and limitations</h2>
          <p className="mt-3 max-w-5xl text-[13px] leading-7 text-emerald-100/60">This is an after-the-fact reconstruction, not an archive of predictions issued before games. Ratings use earlier matches only; games on the same date are predicted before that date's ratings are updated. The initial 3,154 historical training games predate April 8. This test contains 579 matches from April 10 to September 20, because the upstream dataset is not updated through the requested October 7 end date. It contains no archived bookmaker odds, simulated bankroll, player props, or financial returns. Results may not generalize to future seasons.</p>
          <p className="mt-4 break-words text-[11px] text-emerald-100/45">Source: <a className="underline decoration-emerald-400/40 underline-offset-4 hover:text-white" href={`https://github.com/openfootball/football.json/tree/${audit.sourceCommit}`} target="_blank" rel="noopener noreferrer">OpenFootball (CC0-1.0, pinned version)</a> · Reconstructed model: fixed K=20, home advantage=65 Elo points · Data: public-domain match results.</p>
        </section>
        <footer className="mt-12 flex flex-wrap justify-between gap-4 border-t border-emerald-100/10 pt-6 font-mono text-[10px] uppercase tracking-[.14em] text-emerald-100/35"><span>SportsEdge / Research build</span><span>Evaluate first · Publish verified results</span></footer>
      </div>
    </main>
  );
}
