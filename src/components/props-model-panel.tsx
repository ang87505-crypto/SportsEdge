import {Badge,Details,Evidence,KeyValues,Panel,type Tone} from '@/components/ui';
import type {PropsView} from '@/lib/props/dashboard-view';
import {mtShort} from '@/lib/props/summary';
import {MODEL_VERSION} from '@/lib/props/contract';
import {REVIEW_GATE} from '@/lib/props/promotion';

const name=(v:string|null)=>!v?'—':v===MODEL_VERSION?'Stats model':v.replace(/^props-learn-v/,'Learning model v');
const STAT_LABEL={points:'Points',rebounds:'Rebounds',assists:'Assists'} as const;
function state(c:NonNullable<PropsView['model']>['challengers'][number],active:string):{label:string;tone:Tone;note?:string}{
 if(c.version===active)return {label:'Active',tone:'positive'};
 switch(c.state){
  case 'created':return {label:'Replaying',tone:'info'};
  case 'shadow_start':return {label:`Shadowing (${c.gradedLines} of ${REVIEW_GATE.minGradedLines} lines)`,tone:'info'};
  case 'eligible':return {label:'Eligible',tone:'positive'};
  case 'dropped':return {label:'Dropped',tone:'neutral',note:c.reason};
  case 'retired':return {label:'Retired',tone:'neutral'};
  case 'rolled_back':return {label:'Rolled back',tone:'warning'};
  default:return {label:'Promoted earlier',tone:'neutral'};
 }
}

/** What the learning loop is doing: active model, switches, weights in words, and every challenger. */
export function PropsModelPanel({v}:{v:PropsView|null}){
 const m=v?.model??null;
 if(!m)return <Panel title="Model" description="The learning layer scores every line next to the stats model and only takes over after it proves better on real lines." className="mt-12" actions={<Evidence kind="not-measured"/>}>
  <p className="quiet">The learning layer is not set up on this deployment yet, so the stats model ({MODEL_VERSION}) makes every pick. Nothing is shown as learned until it exists.</p>
 </Panel>;
 return <Panel title="Model" description="The learning layer retrains every Sunday, shadows the active model on real lines, and can only take over after it passes the registered test." className="mt-12" actions={<Evidence kind="recorded"/>}>
  <KeyValues items={[
   ['Active model',<span key="a">{name(m.active)}{m.active!==MODEL_VERSION&&<small className="quiet"> · {m.active}</small>}</span>],
   ['Previous model',name(m.previous)],
   ['Learning',m.learningEnabled?'On: retrains every Sunday':'Off: the model stays frozen'],
   ['Auto-switch',m.autoSwitchEnabled?'On: a challenger that passes takes over':'Off: a challenger that passes waits for your approval'],
  ]}/>
  {m.weights&&<div className="mt-12"><h3 className="props-subhead">What it learned</h3>
   <ul className="props-weights">{(Object.keys(STAT_LABEL) as (keyof typeof STAT_LABEL)[]).map(s=>{const w=m.weights![s];return w?<li key={s}>
    <strong>{STAT_LABEL[s]}</strong>: trusts the stats model {w.stats.toFixed(2)}, the sportsbooks {w.books.toFixed(2)}, the matchup {w.matchup.toFixed(2)}
   </li>:null;})}</ul></div>}
  <div className="table-wrap table-scroll mt-12"><table className="data-table ledger-table">
   <thead><tr><th scope="col">Version</th><th scope="col">State</th><th scope="col">Since</th></tr></thead>
   <tbody>{m.challengers.length?m.challengers.map(c=>{const st=state(c,m.active);return <tr key={c.version}>
    <td data-label="Version"><strong>{name(c.version)}</strong><small>{c.version}</small></td>
    <td data-label="State"><Badge tone={st.tone}>{st.label}</Badge>{st.note&&<small>{st.note}</small>}</td>
    <td data-label="Since">{mtShort(c.at)}</td>
   </tr>;}):<tr><td colSpan={3} className="quiet">No challenger trained yet. The first one appears after the next Sunday run.</td></tr>}</tbody>
  </table></div>
 </Panel>;
}

const CAUSE_LABEL:Record<string,string>={minutes_collapse:'Playing time collapsed (injury, blowout, fouls)',books_were_right:'The sportsbooks were right and the model was not',
 matchup:'Tough or easy matchup the model under-weighted',overconfidence:'Model too sure in that confidence range',other:'No single cause'};
/** The latest weekly mistake review, in plain words. */
export function PropsReviewCard({v}:{v:PropsView|null}){
 const r=v?.report??null;
 if(!r)return null;
 const misses=Object.entries(r.report.misses).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
 const total=misses.reduce((a,[,n])=>a+n,0);
 return <Details title="This week's mistakes">
  <p className="quiet">{r.period_from} to {r.period_to} · {name(r.model_version)} · {total} missed pick{total===1?'':'s'}{r.report.voidsExcluded?`, ${r.report.voidsExcluded} void (not counted)`:''}.</p>
  {misses.length?<KeyValues items={misses.map(([k,n])=>[CAUSE_LABEL[k]??k,String(n)] as [string,string])}/>:<p className="quiet">No missed picks this week.</p>}
  {r.report.overconfidentBands.length>0&&<p className="quiet">Overconfident range: {r.report.overconfidentBands.join(', ')}.</p>}
  <p className="quiet small-print">The review explains; Sunday&apos;s retrain does the adjusting.</p>
 </Details>;
}

/** Shown when the safety brake paused picking. */
export function SafetyBrakeBanner({control}:{control:{state:string;reason:string}|null}){
 const m=control?.state==='PAUSED'?/^SAFETY_BRAKE: last (\d+) picks hit ([\d.]+%)/.exec(control.reason):null;
 if(!m)return null;
 return <div className="callout tone-warning" role="alert" style={{marginBottom:12}}><span className="callout-bar" aria-hidden="true"/><div>
  <strong className="callout-title">Paused by the safety brake: last {m[1]} picks hit {m[2]}, confidently below the 57.7% break-even.</strong>
  <div className="callout-body">Grading continues. Review the misses below, then press Resume in Controls when you are ready.</div></div></div>;
}
