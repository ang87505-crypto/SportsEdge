import {Suspense} from 'react';
import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Empty,Loading,Details,Badge,type Tone} from '@/components/ui';
import {loadPropsDashboard,propsDashboardConfigured} from '@/lib/server/props-dashboard';
import {forwardPredictions,summarizeModels,decisionCategories,type PredictionRow} from '@/lib/props/forward-predictions';
import {PLATFORM_LABEL,type Platform} from '@/lib/props/contract';

export const metadata={title:'All predictions · SportsEdge',description:'Every saved pregame player-prop prediction, graded from final box scores, whether or not it became a virtual entry.'};
type Search=Promise<Record<string,string|string[]|undefined>>;
const pct=(x:number|null|undefined)=>x===null||x===undefined?'—':(x*100).toFixed(1)+'%';
const OUT:Record<PredictionRow['outcome'],{label:string;tone:Tone}>={win:{label:'Won',tone:'positive'},loss:{label:'Lost',tone:'negative'},
 tie:{label:'Tie',tone:'neutral'},void:{label:'Void',tone:'neutral'},pending:{label:'Pending',tone:'info'}};
const DEC:Record<PredictionRow['decision'],string>={entered:'In a $5 entry',qualified_not_entered:'Qualified, not entered',skipped:'Skipped',observe_only:'Observed only',no_decision:'Research only'};
const one=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;

export default function Page({searchParams}:{searchParams:Search}){
 return <>
  <PageHeading title="All predictions" description="Every saved pregame forecast from every model, graded from final box scores — including the many that never became a $5 virtual entry. Research results, not returns."
   action={<Link className="button button-secondary" href="/paper-betting/props">Virtual entries</Link>}/>
  <Suspense fallback={<Loading label="Reading every saved prediction"/>}><Live searchParams={searchParams}/></Suspense>
  <Details title="How this is counted">
   <p>The collect run saves a stats-model forecast for every valid pregame line (or records why it could not score it), and every learning model scores each scored line before lock. The settle run grades every saved line from the final box score. Nothing here makes an extra Odds API request.</p>
   <p>Rows are kept per platform. Sample sizes and every accuracy figure count the same event, player, stat and line once (the first platform record), so PrizePicks and Pick6 duplicates are never double-counted.</p>
   <p>&quot;Qualifies&quot; means the model&apos;s probabilities fall in the frozen 60–80% pick band. Only the active model&apos;s qualifying lines become picks, and only some picks become virtual entries (at most three per account per day). No dollar figure is claimed for hypothetical picks.</p>
  </Details>
 </>;
}

async function Live({searchParams}:{searchParams:Search}){
 await connection();
 if(!propsDashboardConfigured())return <Empty title="Sports records are not connected here">This deployment has no props database configured, so no prediction is shown.</Empty>;
 let raw;
 try{raw=await loadPropsDashboard();}catch{return <Empty title="Could not read saved predictions">Refresh to check again. Nothing is assumed.</Empty>;}
 const sp=await searchParams;
 const fp=forwardPredictions(raw);
 const dates=[...new Set(fp.rows.map(x=>x.date))].sort().reverse();
 const date=one(sp.date)&&dates.includes(one(sp.date)!)?one(sp.date)!:dates.find(d=>fp.rows.some(x=>x.date===d&&x.outcome!=='pending'))??dates[0];
 const model=one(sp.model)??'all';
 const ofDay=fp.rows.filter(x=>x.date===date);
 const all=summarizeModels(fp.rows),day=summarizeModels(ofDay),cats=decisionCategories(ofDay);
 const list=ofDay.filter(x=>model==='all'||x.modelVersion===model);
 const models=[...new Set(fp.rows.map(x=>x.modelVersion))];
 const href=(d:string,m:string)=>`/paper-betting/predictions?date=${d}&model=${encodeURIComponent(m)}`;
 if(!fp.rows.length)return <Empty title="No saved predictions in the last 14 days">Predictions appear after the next line collection.</Empty>;
 return <>
  <MetricGrid columns={4}>
   <Metric label="Unique lines (14 days)" value={fp.uniqueLines.toLocaleString()} detail={`${fp.observations.toLocaleString()} platform records · ${fp.unscorable} unscorable`}/>
   <Metric label={`Lines on ${date}`} value={String(cats.all.n)} detail={`${cats.all.graded} graded so far`}/>
   <Metric label="Stats model hit rate (that day)" value={pct(cats.all.hitRate)} detail="Every unique line, picked or not"/>
   <Metric label="Became $5 entries" value={String(cats.entered.n)} detail={`${cats.qualifiedNotEntered.n} qualified, not entered · ${cats.skipped.n} skipped`}/>
  </MetricGrid>
  <Panel title="Accuracy by model" description="Last 14 days, every saved prediction, unique lines. Lower Brier and log loss are better; overlapping intervals mean no model is proven better.">
   <ModelTable ms={all}/>
  </Panel>
  <Panel title={`Decisions on ${date}`} description="Stats-model forecasts by what happened to them (unique lines)">
   <ul className="evidence-list">
    {[['In a $5 virtual entry',cats.entered],['Qualified, not entered (entry limit or rules)',cats.qualifiedNotEntered],['Skipped by the pick rule',cats.skipped],['Recheck captures, observed only',cats.observeOnly]].map(([l,g])=>{
     const x=g as typeof cats.all;return <li key={l as string}><span>{l as string}</span><span>{x.n} · {x.graded?`${pct(x.hitRate)} of ${x.graded} graded`:'none graded'}</span></li>;})}
   </ul>
   {Object.keys(cats.skipped.reasons).length?<p className="home-panel-note">Skip reasons: {Object.entries(cats.skipped.reasons).map(([k,v])=>`${k.replaceAll('_',' ')} ${v}`).join(' · ')}</p>:null}
   <ModelTable ms={day}/>
  </Panel>
  <Panel title="Every prediction" description={`${list.length} rows on ${date}${model==='all'?'':` for ${model}`}`} flush>
   <div className="panel-pad">
    <div className="chat-chips" role="group" aria-label="Date">{dates.slice(0,10).map(d=><Link key={d} className="chat-chip" aria-current={d===date?'true':undefined} href={href(d,model)}>{d}</Link>)}</div>
    <div className="chat-chips" role="group" aria-label="Model" style={{marginTop:8}}>{['all',...models].map(m=><Link key={m} className="chat-chip" aria-current={m===model?'true':undefined} href={href(date,m)}>{m}</Link>)}</div>
   </div>
   <div className="chat-table-scroll"><table className="chat-table predictions-table">
    <thead><tr>{['Player','Line','Model side','Confidence','Model','Qualifies','Decision','Result','Platform'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{list.slice(0,600).map(x=><tr key={x.predictionId} className={x.duplicate?'quiet':undefined}>
     <th scope="row">{x.player}<br/><small className="quiet">{x.game}</small></th>
     <td>{x.stat} {x.line}</td><td>{x.side}</td><td>{pct(x.confidence)}</td><td><small>{x.modelVersion}</small></td>
     <td>{x.qualifies?'Yes':'No'}</td><td><small>{DEC[x.decision]}{x.skipReason?` (${x.skipReason.replaceAll('_',' ')})`:''}</small></td>
     <td><Badge tone={OUT[x.outcome].tone}>{OUT[x.outcome].label}</Badge>{x.actual!==null?<small className="quiet"> {x.actual}</small>:null}</td>
     <td><small>{PLATFORM_LABEL[x.platform as Platform]??x.platform}{x.duplicate?' (same line)':''}</small></td>
    </tr>)}</tbody>
   </table></div>
   {list.length>600&&<p className="quiet panel-pad">Showing 600 of {list.length}; choose a model to narrow the list.</p>}
  </Panel>
 </>;
}

function ModelTable({ms}:{ms:ReturnType<typeof summarizeModels>}){
 return <div className="chat-table-scroll"><table className="chat-table">
  <thead><tr>{['Model','Graded','Hit rate (95% CI)','Brier','Log loss','Calibration error','Qualifying hit rate','Pending'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
  <tbody>{ms.map(m=><tr key={m.modelVersion}>
   <th scope="row">{m.modelVersion} {m.role==='active'?<Badge tone="info">active</Badge>:m.role==='challenger'?<Badge>challenger</Badge>:null}</th>
   <td>{m.graded}</td><td>{pct(m.hitRate)} <small className="quiet">({pct(m.hitLower)}–{pct(m.hitUpper)})</small></td>
   <td>{m.brier?.toFixed(4)??'—'}</td><td>{m.logLoss?.toFixed(4)??'—'}</td><td>{pct(m.ece)}</td>
   <td>{m.qualifying.graded?`${pct(m.qualifying.hitRate)} of ${m.qualifying.graded}`:'—'}</td><td>{m.pending}</td>
  </tr>)}</tbody>
 </table></div>;
}
