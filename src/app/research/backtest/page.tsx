"use client";

import Link from 'next/link';
import {useMemo,useState} from "react";
import {PageHeading,Panel,Metric,MetricGrid,Evidence,Callout,Details,Badge,Segmented} from "@/components/ui";
import {PairedBars} from '@/components/charts';
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
  return <>
    <PageHeading title="Soccer accuracy history" description="Reconstructed pregame probabilities for five European leagues compared with final results. A historical test, not live picks."
      meta={<><Evidence kind="historical"/><Badge tone="neutral">Apr 8 – Oct 7, 2026 window</Badge></>}
      action={<Link href="/research/epl" className="button button-secondary">Soccer model</Link>}/>
    <Callout tone="info" title="No prices, no ROI">Source coverage ends September 20, 2026. No historical sportsbook prices exist for these games, so no betting return is reported.</Callout>

    <div className="board-toolbar">
      <Segmented label="League" value={league} onChange={v=>{setLeague(v);setPage(0);}} options={LEAGUES.map(l=>({value:l.id,label:l.id==='all'?'All':l.name}))}/>
    </div>
    <MetricGrid columns={4}>
      <Metric label="Evaluated matches" value={current.games} detail={league==='all'?'Five European leagues':audit.leagues[league].label}/>
      <Metric label="Outcome accuracy" value={percent(current.accuracy)} detail={`Frequency baseline ${percent(current.baselineAccuracy)}`}/>
      <Metric label="Log loss" value={fixed(current.logLoss)} hint="Lower is better." detail={`Baseline ${fixed(current.baselineLogLoss)}`} tone={current.logLoss<current.baselineLogLoss?'positive':'negative'}/>
      <Metric label="Three-class Brier" value={fixed(current.brier)} hint="Lower is better." detail={`Baseline ${fixed(current.baselineBrier)}`} tone={current.brier<current.baselineBrier?'positive':'negative'}/>
    </MetricGrid>

    <Panel title="Accuracy by league" description="Model's most likely outcome against a fixed home/draw/away frequency baseline" className="mt-12">
      <PairedBars labels={['Elo model','Frequency baseline']} scale={[0.3,0.6]} format="pct1"
        rows={LEAGUES.filter(l=>l.id!=='all').map(l=>{const m=audit.leagues[l.id as Exclude<League,'all'>];return {label:l.name,a:m.accuracy,b:m.baselineAccuracy,note:`${m.games} games`};})}/>
    </Panel>

    <Panel title="Predicted vs. actual" description={`${filtered.length} matching games`} flush className="mt-12"
      actions={<label className="check-label"><input type="checkbox" checked={onlyMisses} onChange={e=>{setOnlyMisses(e.target.checked);setPage(0)}}/> Mistakes only</label>}>
      <div className="table-wrap"><table className="data-table ledger-table">
        <thead><tr><th scope="col">Match</th><th scope="col">Home / draw / away</th><th scope="col">Predicted</th><th scope="col">Result</th><th scope="col">Outcome</th></tr></thead>
        <tbody>{rows.map((g,i)=><tr key={`${g.date}-${g.home}-${i}`}>
          <td data-label="Match"><strong>{g.home}</strong> vs {g.away}<small>{g.date}, {audit.leagues[g.league as keyof typeof audit.leagues].label}</small></td>
          <td data-label="Probabilities" className="tabular">{g.probabilities.map(percent).join(' / ')}</td>
          <td data-label="Predicted">{outcomeLabel(g.prediction)}</td>
          <td data-label="Result">{g.score.join('–')}<small>{outcomeLabel(g.actual)}</small></td>
          <td data-label="Outcome"><Badge tone={g.correct?'positive':'negative'}>{g.correct?'Correct':'Missed'}</Badge></td>
        </tr>)}</tbody>
      </table></div>
      <div className="pager">
        <span>Showing {filtered.length===0?0:page*PAGE+1}–{Math.min((page+1)*PAGE,filtered.length)} of {filtered.length}</span>
        <div className="button-row">
          <button type="button" className="button button-secondary button-sm" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button>
          <span className="tabular">{page+1} / {totalPages}</span>
          <button type="button" className="button button-secondary button-sm" disabled={page+1>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))}>Next</button>
        </div>
      </div>
    </Panel>

    <Details title="Methodology, source and limitations"><p>This is an after-the-fact reconstruction, not an archive of predictions issued before games. Ratings use earlier matches only; all games on a date are predicted before that date&apos;s ratings update.</p><p>The 3,154 training games predate April 8. The test has 579 matches from April 10 to September 20, with no bookmaker odds, simulated bankroll or financial returns. Results may not generalize.</p><p>Fixed Elo K=20, home advantage 65 points. Source: <a href={`https://github.com/openfootball/football.json/tree/${audit.sourceCommit}`} target="_blank" rel="noopener noreferrer">OpenFootball, pinned public-domain CC0 dataset</a>.</p></Details>
  </>;
}
