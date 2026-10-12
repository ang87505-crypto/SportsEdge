"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useState} from "react";
import {PageHeading,Empty} from "@/components/ui";
import {analyzeNbaGames,type StoredGame,type StoredForecast} from "@/lib/nba-opportunities";

type ResearchResponse={predictions?:StoredForecast[]};
type SportsResponse={status?:string;games?:StoredGame[];quoteLimitReached?:boolean};
type ReadResult={games:StoredGame[];forecasts:StoredForecast[];readAt:number;truncated:boolean};
const pct=(n:number)=>(n*100).toFixed(1)+"%";
const odds=(n:number)=>n>0?"+"+n:String(n);
const when=(s:string)=>new Date(s).toLocaleString(undefined,{
  month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
});
const labels={screened:"Research candidate",no_edge:"No model-estimated edge",
  stale:"Stale prices",incomplete:"Market unavailable",no_forecast:"No usable forecast"};

export default function GameAnalysisPage(){
  const [result,setResult]=useState<ReadResult|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(true);
  const [now,setNow]=useState(0);
  const load=useCallback(async(signal?:AbortSignal)=>{
    // Initial effect uses existing loading state; user-triggered refresh updates it.
    if(!signal){setBusy(true);setError("");}
    try{
      // Read existing stored forecasts and snapshots only. No sportsbook provider call.
      const [sports,research]=await Promise.all([
        fetch("/api/sports?sport=nba",{cache:"no-store",signal}),
        fetch("/api/research",{cache:"no-store",signal})
      ]);
      if(!sports.ok||!research.ok)throw new Error("Stored sports research is temporarily unavailable.");
      const a=(await sports.json()) as SportsResponse,b=(await research.json()) as ResearchResponse;
      if(a.status!=="stored"||!Array.isArray(a.games)||!Array.isArray(b.predictions))
        throw new Error("Research results are incomplete. No analysis has been substituted.");
      if(signal?.aborted)return;
      setResult({games:a.games,forecasts:b.predictions,readAt:Date.now(),truncated:Boolean(a.quoteLimitReached)});
      setNow(Date.now());
    }catch(e){
      if(signal?.aborted)return;
      setResult(null);
      setError(e instanceof Error?e.message:"Unable to verify stored sports data.");
    }finally{if(!signal?.aborted)setBusy(false);}
  },[]);
  useEffect(()=>{
    const c=new AbortController();
    queueMicrotask(()=>{if(!c.signal.aborted)void load(c.signal);});
    const tick=setInterval(()=>setNow(Date.now()),5000);
    return ()=>{c.abort();clearInterval(tick);};
  },[load]);
  const games=useMemo(()=>{
    if(!result||!now)return [];
    try{return analyzeNbaGames(result.games,result.forecasts,now);}
    catch{return [];}
  },[result,now]);
  const count=games.filter(g=>g.status==="screened").length;
  return <div>
    <PageHeading eyebrow="NBA GAME ANALYSIS" title="Understand the price before the pick."
      description="Compare published NBA model predictions with recorded sportsbook prices in one place. The screening updates as stored prices get older, and will never place a wager."/>
    <section className="glass panel" style={{marginBottom:20}}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong className="text-base text-white">Read-only NBA screening</strong>
          <p className="text-sm text-[#b5caba]">A positive model estimate is not a guaranteed win or a verified sportsbook offer.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void load()}>
            {busy?"Checking…":"Refresh stored data ↻"}
          </button>
          <Link href="/paper-betting" className="button button-secondary">Paper-bet ledger ↗</Link>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 p-4"><span className="text-xs text-[#a5bdb0]">Upcoming games examined</span><p className="mt-2 text-2xl font-semibold">{result?games.length:"—"}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><span className="text-xs text-[#a5bdb0]">Passing preliminary screen</span><p className="mt-2 text-2xl font-semibold">{result?count:"—"}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><span className="text-xs text-[#a5bdb0]">Stored data retrieved</span><p className="mt-2 text-sm font-semibold">{result?when(new Date(result.readAt).toISOString()):"Not available"}</p></div>
      </div>
      <p className="mt-4 text-xs text-[#9fb7a9]">Refreshing this screen reads SportsEdge&apos;s existing database; it does not purchase new sportsbook quotes. A quote is considered screenable only up to 60 seconds after its recorded source observation. Time checks update while this page is open.</p>
      {result?.truncated&&<p className="notice">The stored odds query hit its 1,000-row limit. Treat incomplete markets as unavailable. Do not rely on this screen for execution.</p>}
    </section>
    {error&&<div className="notice" role="alert">{error} No picks or prices have been invented.</div>}
    {busy&&!result&&!error&&<div className="glass loading" role="status">Checking published NBA predictions and stored bookmaker observations…</div>}
    {!busy&&result&&games.length===0&&<section className="glass"><Empty title="No upcoming NBA matchups to screen">We will show analysis once upcoming fixtures are available in the stored data. Existing bets remain in the paper ledger.</Empty></section>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {games.map(g=><article className="glass p-5 sm:p-6" key={g.gameId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs tracking-wider text-[#a9c5b5]">NBA · {when(g.startsAt)}</div>
            <h2 className="mt-2 text-xl">{g.away} <span className="text-[#9cb6a5]">at</span> {g.home}</h2>
          </div>
          <span className={g.status==="screened"?"pill":g.status==="stale"?"pill pill-amber":"pill"}>{labels[g.status]}</span>
        </div>
        <p className="mt-3 text-sm text-[#b3caba]">{g.reason}</p>
        {g.forecast&&<div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 p-3">
            <div className="text-xs text-[#9eb7a9]">{g.home} model chance</div>
            <div className="mt-1 text-xl font-semibold">{pct(Number(g.forecast.home_probability))}</div>
          </div>
          <div className="rounded-xl border border-white/10 p-3">
            <div className="text-xs text-[#9eb7a9]">{g.away} model chance</div>
            <div className="mt-1 text-xl font-semibold">{pct(1-Number(g.forecast.home_probability))}</div>
          </div>
        </div>}
        {g.best&&<div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{g.best.selection} · {g.best.sportsbook}</span>
            <span className={g.best.fresh?"pill":"pill pill-amber"}>{g.best.fresh?"Recently recorded":"Expired observation"}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><span className="block text-xs text-[#9eb7a9]">Recorded odds</span><strong>{odds(g.best.americanOdds)}</strong></div>
            <div><span className="block text-xs text-[#9eb7a9]">Market no-vig chance</span><strong>{pct(g.best.marketNoVigProbability)}</strong></div>
            <div><span className="block text-xs text-[#9eb7a9]">Model-estimated EV</span><strong>{g.best.fresh?pct(g.best.estimatedEv):"Not actionable"}</strong></div>
          </div>
          <p className="mt-3 text-xs text-[#9eb7a9]">Source: {g.best.provider} · observed {when(g.best.observedAt)} · {g.freshMarketCount} fresh of {g.completeMarketCount} complete recorded market(s).</p>
        </div>}
        {g.forecast&&<div className="mt-4 text-xs text-[#a1b7aa]">Model: {g.forecast.model_version}<span className="block">Published: {when(g.forecast.published_at)} · research-only probability, no injury or current-lineup adjustment.</span></div>}
      </article>)}
    </div>
    <section className="glass panel mt-6">
      <h2>What does “research candidate” mean?</h2>
      <p className="mt-2 text-sm text-[#adbeae]">The model&apos;s probability implies at least 2% expected value at a complete, recently recorded moneyline market and exceeds that market&apos;s no-vig probability. It does not mean a sportsbook will still honor the price, and it is not a personal betting recommendation.</p>
      <p className="mt-3 text-sm text-[#adbeae]">This page never creates paper bets. The authorized paper-betting service must independently confirm current odds, game eligibility, virtual bankroll and account rules immediately before recording anything. The separate proposed 100 × $10 NBA study is not active.</p>
      <Link className="button button-secondary mt-4" href="/sports">← Back to Sports</Link>
    </section>
  </div>;
}
