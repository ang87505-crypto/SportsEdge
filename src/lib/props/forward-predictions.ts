/**
 * Every saved pregame prediction, not just entry legs. Pure read model over the saved props snapshot (Raw).
 *
 * The collect run already stores a stats-model forecast for EVERY valid pregame line (scored or explicitly unscorable),
 * every learning model scores every scored line before lock, and the settle run grades EVERY observation from final box
 * scores whether or not it was picked or entered. This module only reads those rows; it writes nothing and calls nothing.
 *
 * Three ledgers stay separate: predictions (every model, every line), pick decisions (qualified or skipped, by the model
 * that decided), and virtual entries (the $5 PAPER legs). Platform-specific rows are kept; unique sample sizes count the
 * same event/player/stat/line once (the first platform record by observation id).
 */
import type {Raw} from './dashboard-view.ts';
import {MODEL_VERSION} from './contract.ts';
import {decidePick} from './rules.ts';
import {playerKey} from './identity.ts';
import {properScore,type Probabilities} from './research.ts';

export type Outcome='win'|'loss'|'tie'|'void'|'pending';
export type Decision='entered'|'qualified_not_entered'|'skipped'|'observe_only'|'no_decision';
export type PredictionRow={predictionId:number;observationId:number;platform:string;eventId:string;game:string;player:string;stat:string;line:number;
 lockAt:string;date:string;modelVersion:string;role:'stats'|'active'|'challenger';side:'more'|'less';confidence:number;probs:Probabilities;mean:number|null;
 /** Would this model's probabilities pass the frozen props-select-v1 band (60–80%, tie ≤ 5%)? A research fact, not a pick. */
 qualifies:boolean;decision:Decision;skipReason:string|null;outcome:Outcome;actual:number|null;key:string;duplicate:boolean};
export type ModelSummary={modelVersion:string;role:PredictionRow['role'];predictions:number;unique:number;graded:number;wins:number;losses:number;ties:number;
 hitRate:number|null;hitLower:number|null;hitUpper:number|null;brier:number|null;logLoss:number|null;ece:number|null;
 qualifying:{graded:number;wins:number;hitRate:number|null;hitLower:number|null;hitUpper:number|null};pending:number;voids:number};

const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const r=(x:number|null,d=4)=>x===null||!Number.isFinite(x)?null:Math.round(x*10**d)/10**d;
function wilson(k:number,n:number){if(!n)return {lower:null,upper:null};const z=1.96,p=k/n,z2=z*z,den=1+z2/n,c=p+z2/(2*n),h=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n));return {lower:(c-h)/den,upper:(c+h)/den};}
const vnum=(v:string)=>Number(/-v(\d+)$/.exec(v)?.[1]??0);

export function forwardPredictions(raw:Raw){
 const active=raw.model?.active??MODEL_VERSION;
 const obs=new Map(raw.observations.map(o=>[o.id,o]));
 const latest=new Map<number,Raw['results'][number]>();
 for(const x of raw.results){const p=latest.get(x.observation_id);if(!p||x.revision>p.revision)latest.set(x.observation_id,x);}
 const pickByPred=new Map(raw.picks.map(k=>[k.prediction_id,k]));
 const entered=new Set(raw.legs.map(l=>l.pick_id));
 // Lines the tick captured as an observe-only recheck have predictions but deliberately no pick decision.
 const obsOfPred=new Map(raw.predictions.map(p=>[p.id,p.observation_id]));
 const decidedObs=new Set(raw.picks.map(k=>obsOfPred.get(k.prediction_id)).filter((x):x is number=>x!==undefined));
 const firstKey=new Map<string,number>();
 const keyOf=(o:Raw['observations'][number])=>[o.provider_event_id,playerKey(o.player_name),o.stat,Number(o.line)].join('|');
 for(const o of [...raw.observations].sort((a,b)=>a.id-b.id)){const k=keyOf(o);if(!firstKey.has(k))firstKey.set(k,o.id);}
 const rows:PredictionRow[]=[];
 let unscorable=0;
 for(const p of raw.predictions){
  const o=obs.get(p.observation_id);if(!o)continue;
  if(p.status!=='scored'||p.p_more===null||p.p_less===null||p.p_tie===null){if(p.model_version===MODEL_VERSION)unscorable++;continue;}
  const probs={pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)};
  const side=probs.pMore>=probs.pLess?'more':'less';
  const confidence=probs.pTie<1?Math.max(probs.pMore,probs.pLess)/(1-probs.pTie):0.5;
  const pick=pickByPred.get(p.id);
  const decision:Decision=pick?(pick.status==='recorded'?(entered.has(pick.id)?'entered':'qualified_not_entered'):'skipped'):
   !decidedObs.has(o.id)&&p.model_version===MODEL_VERSION?'observe_only':'no_decision';
  const res=latest.get(o.id);
  const outcome:Outcome=!res?'pending':res.outcome==='more'||res.outcome==='less'?(res.outcome===side?'win':'loss'):res.outcome==='tie'?'tie':'void';
  const key=keyOf(o);
  rows.push({predictionId:p.id,observationId:o.id,platform:o.platform,eventId:o.provider_event_id,game:`${o.away_team} @ ${o.home_team}`,player:o.player_name,
   stat:o.stat,line:Number(o.line),lockAt:o.lock_at,date:etDate(o.lock_at),modelVersion:p.model_version,
   role:p.model_version===MODEL_VERSION&&active===MODEL_VERSION?'active':p.model_version===MODEL_VERSION?'stats':p.model_version===active?'active':'challenger',
   side,confidence,probs,mean:p.mean===null?null:Number(p.mean),qualifies:decidePick({status:'scored',...probs}).status==='recorded',
   decision,skipReason:pick&&pick.status!=='recorded'?pick.reason:null,outcome,actual:res?.actual??null,key,duplicate:firstKey.get(key)!==o.id});
 }
 rows.sort((a,b)=>b.lockAt.localeCompare(a.lockAt)||a.player.localeCompare(b.player)||a.modelVersion.localeCompare(b.modelVersion)||a.platform.localeCompare(b.platform));
 const uniqueKeys=new Set(raw.observations.map(keyOf));
 return {rows,active,unscorable,uniqueLines:uniqueKeys.size,observations:raw.observations.length};
}

/** Metrics on UNIQUE lines (duplicates across platforms count once). Ties are scored by Brier/log loss; hit rate excludes ties. */
export function summarizeModels(rows:PredictionRow[]):ModelSummary[]{
 const versions=[...new Set(rows.map(x=>x.modelVersion))];
 return versions.map(v=>{
  const mine=rows.filter(x=>x.modelVersion===v),uniq=mine.filter(x=>!x.duplicate);
  const graded=uniq.filter(x=>x.outcome==='win'||x.outcome==='loss'||x.outcome==='tie');
  const wins=graded.filter(x=>x.outcome==='win').length,losses=graded.filter(x=>x.outcome==='loss').length,ties=graded.filter(x=>x.outcome==='tie').length;
  let brier=0,logLoss=0;const bins=Array.from({length:10},()=>({n:0,p:0,y:0}));
  for(const x of graded){
   const actual=x.outcome==='tie'?'tie':(x.outcome==='win')===(x.side==='more')?'more':'less';
   const s=properScore(x.probs,actual);brier+=s.brier;logLoss+=s.logLoss;
   if(actual!=='tie'){const q=x.probs.pTie<1?x.probs.pMore/(1-x.probs.pTie):0.5,b=bins[Math.min(9,Math.floor(q*10))];b.n++;b.p+=q;b.y+=Number(actual==='more');}
  }
  const directional=wins+losses,w=wilson(wins,directional);
  const nb=bins.reduce((a,b)=>a+b.n,0);
  const q=graded.filter(x=>x.qualifies&&x.outcome!=='tie'),qw=q.filter(x=>x.outcome==='win').length,qi=wilson(qw,q.length);
  return {modelVersion:v,role:mine[0].role,predictions:mine.length,unique:uniq.length,graded:graded.length,wins,losses,ties,
   hitRate:directional?r(wins/directional):null,hitLower:r(w.lower),hitUpper:r(w.upper),
   brier:graded.length?r(brier/graded.length,5):null,logLoss:graded.length?r(logLoss/graded.length,5):null,
   ece:nb?r(bins.reduce((a,b)=>a+(b.n?b.n/nb*Math.abs(b.p/b.n-b.y/b.n):0),0)):null,
   qualifying:{graded:q.length,wins:qw,hitRate:q.length?r(qw/q.length):null,hitLower:r(qi.lower),hitUpper:r(qi.upper)},
   pending:uniq.filter(x=>x.outcome==='pending').length,voids:uniq.filter(x=>x.outcome==='void').length};
 }).sort((a,b)=>(a.role==='active'?0:a.role==='stats'?1:2)-(b.role==='active'?0:b.role==='stats'?1:2)||vnum(b.modelVersion)-vnum(a.modelVersion));
}

/** Decision categories for the stats model's forecasts (the model every line has), on unique lines. */
export function decisionCategories(rows:PredictionRow[]){
 const base=rows.filter(x=>x.modelVersion===MODEL_VERSION&&!x.duplicate);
 const by=(d:Decision)=>base.filter(x=>x.decision===d);
 const graded=(xs:PredictionRow[])=>{const g=xs.filter(x=>x.outcome==='win'||x.outcome==='loss');const k=g.filter(x=>x.outcome==='win').length;return {n:xs.length,graded:g.length,wins:k,hitRate:g.length?r(k/g.length):null};};
 const reasons:Record<string,number>={};for(const x of by('skipped'))reasons[x.skipReason??'other']=(reasons[x.skipReason??'other']??0)+1;
 return {all:graded(base),entered:graded(by('entered')),qualifiedNotEntered:graded(by('qualified_not_entered')),skipped:{...graded(by('skipped')),reasons},
  observeOnly:graded(by('observe_only')),noDecision:graded(by('no_decision'))};
}

/** The newest learning model (highest props-learn-vN) present in the snapshot. */
export function newestModel(rows:PredictionRow[]):string|null{
 const learn=[...new Set(rows.map(x=>x.modelVersion))].filter(v=>/^props-learn-v\d+$/.test(v)).sort((a,b)=>vnum(b)-vnum(a));
 return learn[0]??null;
}
