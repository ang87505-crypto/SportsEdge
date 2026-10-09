"use client";
import {useState} from "react";

type Market = "sports" | "stocks";

type SportsPreview = {
  predictions?: {starts_at?: string}[];
};
type OddsPreview = {
  status?: string;
  games?: {startsAt?: string;bookmakers?: {updatedAt?: string}[]}[];
};

export function PaperRunControls({market}:{market:Market}) {
  const [checking,setChecking]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const sports=market==="sports";
  async function checkReadiness() {
    if(checking)return;
    setChecking(true);setMessage(null);
    try {
      if(!sports) {
        setMessage("Blocked: no independently verified stock-price feed, owner account, durable $1,000 stock execution ledger, or approved model-run adapter is connected. The existing manual stock journal is unaffected.");
        return;
      }
      const responses=await Promise.all([
        fetch("/api/research",{cache:"no-store",headers:{Accept:"application/json"}}),
        fetch("/api/sports?sport=nba",{cache:"no-store",headers:{Accept:"application/json"}})
      ]);
      if(responses.some(r=>!r.ok))throw new Error("Stored data is temporarily unavailable.");
      const research=(await responses[0].json()) as SportsPreview;
      const feed=(await responses[1].json()) as OddsPreview;
      if(!Array.isArray(research.predictions)||feed.status!=="stored"||!Array.isArray(feed.games))throw new Error("Stored data is incomplete.");
      const now=Date.now(),freshCutoff=now-3_600_000;
      const upcoming=research.predictions.filter(f=>f.starts_at&&Number.isFinite(Date.parse(f.starts_at))&&Date.parse(f.starts_at)>now).length;
      const observations=feed.games.filter(g=>g.startsAt&&Date.parse(g.startsAt)>now)
        .flatMap(g=>Array.isArray(g.bookmakers)?g.bookmakers:[])
        .filter(q=>{const t=q.updatedAt?Date.parse(q.updatedAt):NaN;return Number.isFinite(t)&&t<=now&&t>=freshCutoff;}).length;
      setMessage("Read-only data check: "+upcoming+" future NBA forecast(s) and "+observations+" recently observed displayed moneyline quote(s). This does not establish complete markets, positive expected value or executable prices. Owner authentication is not configured, so no paper wager was placed.");
    } catch {
      setMessage("Could not verify stored research and odds right now. No paper positions were created or modified.");
    } finally {
      setChecking(false);
    }
  }
  return <section className="glass panel" aria-labelledby={sports?"nba-run-heading":"stock-run-heading"} style={{marginBottom:24}}>
    <div className="module-top" style={{marginBottom:16,flexWrap:"wrap",gap:8}}>
      <span className="pill">Owner-commanded · virtual money only</span>
      <span className="pill pill-amber">Run disabled · owner login required</span>
    </div>
    <h2 id={sports?"nba-run-heading":"stock-run-heading"}>{sports?"Sports paper-bet controls":"Automated stock paper-trade controls"}</h2>
    <p style={{color:"var(--muted)",margin:"12px 0 18px"}}>
      {sports
        ?"The existing NBA ledger uses its frozen 1%-of-available-cash research rules. The separate proposed 100 × $10 study is not active. No prices are refreshed by this page."
        :"A separate $1,000 stock study and model execution planner are proposed in draft research PRs. Neither is connected to an authenticated trading runner or a live market feed. Your $10,000 manual browser journal stays separate."}
    </p>
    <div className="button-row">
      <button type="button" className="button" disabled aria-describedby={sports?"sports-run-blocker":"stock-run-blocker"}>
        {sports?"Run sports paper bets":"Run stock paper trades"}
      </button>
      <button type="button" className="button button-secondary" disabled={checking} onClick={checkReadiness}>
        {checking?"Checking stored data…":"Check readiness"}
      </button>
    </div>
    <p id={sports?"sports-run-blocker":"stock-run-blocker"} className="quiet" style={{fontSize:12,marginTop:14}}>
      A future owner-authenticated one-run action must verify permissions and current market data on the server before recording any paper trades. No tokens are accepted or stored in this browser.
    </p>
    {message&&<p role="status" aria-live="polite" className="notice" style={{marginTop:16}}>{message}</p>}
  </section>;
}
