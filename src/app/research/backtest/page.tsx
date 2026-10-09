"use client";

import { useMemo, useState } from "react";
import {PageHeading, Stat, Details, Action} from "@/components/ui";
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
  return <><PageHeading eyebrow="HISTORICAL SOCCER RESEARCH" title="See how past predictions performed." description="Compare reconstructed pregame probabilities with recorded results. These are historical tests, not live picks." action={<Action href="/research/epl" secondary>EPL forecast archive ↗</Action>}/><div className="notice">Requested window: April 8–October 7, 2026. Source coverage ends September 20, 2026. No historical sportsbook prices or betting ROI are available.</div><div className="stats-grid"><Stat label="Evaluated matches" value={current.games} detail={league==='all'?'Five European leagues':audit.leagues[league].label}/><Stat label="Outcome accuracy" value={percent(current.accuracy)} detail={`Simple baseline ${percent(current.baselineAccuracy)}`}/><Stat label="Log loss" value={fixed(current.logLoss)} detail={`Lower is better · baseline ${fixed(current.baselineLogLoss)}`}/><Stat label="Three-class Brier" value={fixed(current.brier)} detail={`Lower is better · baseline ${fixed(current.baselineBrier)}`}/></div><Details title="What do these numbers mean?"><p>Accuracy measures whether the model’s most likely outcome—home win, draw or away win—matched the result. Log loss and Brier measure the quality of the probabilities. Lower values are better.</p><p>The simple baseline always uses home/draw/away frequencies measured before the test window. Prediction accuracy is not a betting win rate or evidence of profit.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>League</th><th>Games</th><th>Accuracy</th></tr></thead><tbody>{LEAGUES.filter(l=>l.id!=='all').map(l=>{const m=audit.leagues[l.id as keyof typeof audit.leagues];return <tr key={l.id}><td>{l.name}</td><td>{m.games}</td><td>{percent(m.accuracy)}</td></tr>})}</tbody></table></div></Details><div className="section-title"><h2>Predicted vs. actual</h2><span className="quiet">{filtered.length} matching games</span></div><div className="toolbar"><label>League <select value={league} onChange={e=>{setLeague(e.target.value as League);setPage(0)}}>{LEAGUES.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select></label><label className="button-row"><input type="checkbox" style={{width:18}} checked={onlyMisses} onChange={e=>{setOnlyMisses(e.target.checked);setPage(0)}}/> Show mistakes only</label></div><section className="glass"><div className="table-wrap"><table className="data-table"><thead><tr><th>Date / match</th><th>Model chance: home / draw / away</th><th>Predicted</th><th>Final result</th><th>Outcome</th></tr></thead><tbody>{rows.map((g,i)=><tr key={`${g.date}-${g.home}-${i}`}><td>{g.home} · {g.away}<small>{g.date} · {audit.leagues[g.league as keyof typeof audit.leagues].label}</small></td><td>{g.probabilities.map(percent).join(' / ')}</td><td>{outcomeLabel(g.prediction)}</td><td>{g.score.join('–')}<small>{outcomeLabel(g.actual)}</small></td><td><span className={`pill ${g.correct?'':'pill-amber'}`}>{g.correct?'Correct':'Missed'}</span></td></tr>)}</tbody></table></div><div className="toolbar panel"><span>Showing {filtered.length===0?0:page*PAGE+1}–{Math.min((page+1)*PAGE,filtered.length)} of {filtered.length}</span><div className="button-row"><button className="button button-secondary" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button><span>{page+1} / {totalPages}</span><button className="button button-secondary" disabled={page+1>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}>Next</button></div></div></section><Details title="Methodology, source and limitations"><p>This is an after-the-fact reconstruction, not an archive of predictions issued before games. Ratings use earlier matches only; all games on a date are predicted before that date’s ratings are updated.</p><p>The 3,154 training games predate April 8. The test contains 579 matches from April 10 to September 20. It contains no archived bookmaker odds, simulated bankroll, player props or financial returns. Results may not generalize to future seasons.</p><p>Fixed Elo K=20, home advantage=65 points. Source: <a href={`https://github.com/openfootball/football.json/tree/${audit.sourceCommit}`}>OpenFootball, pinned public-domain CC0 dataset ↗</a>.</p></Details></>;
}
