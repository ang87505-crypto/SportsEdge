/**
 * AI Learning Lab forward worker (lab-sports-ablation-v1). SERVER/WORKER ONLY. RESEARCH ONLY.
 *   freeze  before each lock: every ablation variant's forecast and the pre-lock risk flags for lines the collect run
 *           already stored. Inputs are limited to rows the database had at the line's capture time. Zero paid requests.
 *   report  after grading: the forward comparison, layer verdicts, flag effectiveness and mistake patterns.
 * It never records a pick, an entry or a stake, and never changes the active model, a threshold or a control.
 * If the lab tables are not migrated yet it reports NOT_MIGRATED and does nothing.
 */
import type {PropsStore} from './props-store.ts';
import {PropsStoreError} from './props-store.ts';
import {predictLine,type GameLog,type ModelParams} from '../props/model.ts';
import {matchupFeatures,type TeamGameRow} from '../props/features.ts';
import {teamAbbr} from '../props/identity.ts';
import {decidePick} from '../props/rules.ts';
import {MODEL_VERSION,type Stat} from '../props/contract.ts';
import {SPORTS_ABLATION,SPORTS_ABLATION_SPEC} from '../lab/sports/spec.ts';
import {predictVariant,labArtifactSha256,type SportsLabArtifact,type SportsLabInput} from '../lab/sports/variants.ts';
import {riskFlags,flagEffectiveness,RISK_RULES_V1,COVERAGE_GAPS,type CalibrationCell,type RiskFlag} from '../lab/sports/risk.ts';
import {compareVariants,type LabRow} from '../lab/compare.ts';
import {diagnoseMistakes,type GradedPick} from '../lab/sports/attribution.ts';
import {ROLE_CHANGE} from '../lab/sports/role.ts';

const EXP=SPORTS_ABLATION_SPEC.id;
const q=encodeURIComponent;
const PAGE=1000,IDS=150;
const DAY=86400_000;
const LOCK_MARGIN_MS=2*60_000;
const chunk=<T,>(xs:T[],n:number)=>Array.from({length:Math.ceil(xs.length/n)},(_,i)=>xs.slice(i*n,i*n+n));
const inList=(xs:(string|number)[])=>'in.('+xs.map(x=>typeof x==='number'?String(x):'"'+String(x).replace(/["\\]/g,'')+'"').join(',')+')';
const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
async function paged<T>(store:PropsStore,table:string,query:string,max=20):Promise<T[]>{
 const out:T[]=[];
 for(let p=0;p<max;p++){const got=await store.select<T>(table,query+'&limit='+PAGE+'&offset='+p*PAGE);out.push(...got);if(got.length<PAGE)break;}
 return out;
}
async function byIds<T>(store:PropsStore,table:string,select:string,column:string,ids:(string|number)[],extra=''):Promise<T[]>{
 const out:T[]=[];
 for(const part of chunk([...new Set(ids)],IDS))out.push(...await store.select<T>(table,'select='+select+'&'+column+'='+inList(part)+extra+'&limit=5000'));
 return out;
}

export type StoredLabArtifact={artifact:SportsLabArtifact;artifactSha256:string;calibrationTable:CalibrationCell[]};
export type ModelFile={params:ModelParams;players:Record<string,{games:number;minutes:number;points:number;rebounds:number;assists:number}>};
export type LabDeps={store:PropsStore;now:()=>string;lab:StoredLabArtifact;model:ModelFile;seasonStart:string};

/** The frozen artifact must match its hash and the frozen spec; anything else is refused, never used. */
export function verifyLabArtifact(s:StoredLabArtifact):boolean{
 return labArtifactSha256(s.artifact)===s.artifactSha256&&s.artifact.specSha256===SPORTS_ABLATION.sha256&&
  SPORTS_ABLATION_SPEC.variants.every(v=>!!s.artifact.variants[v.id]);
}

/** Register the experiment once (idempotent); NOT_MIGRATED when the lab tables do not exist yet. */
async function ensureRegistered(d:LabDeps):Promise<'OK'|'NOT_MIGRATED'|'SPEC_CONFLICT'>{
 let rows:{spec_sha256:string}[];
 try{rows=await d.store.select<{spec_sha256:string}>('props_lab_experiments','select=spec_sha256&id=eq.'+EXP);}
 catch(e){if(e instanceof PropsStoreError&&/^(DB_42P01|STORE_HTTP_404|DB_PGRST\w*|PGRST)/.test(e.code))return 'NOT_MIGRATED';throw e;}
 if(rows.length)return rows[0].spec_sha256===SPORTS_ABLATION.sha256?'OK':'SPEC_CONFLICT';
 await d.store.insert('props_lab_experiments',[{id:EXP,spec_sha256:SPORTS_ABLATION.sha256,artifact_sha256:d.lab.artifactSha256,spec:SPORTS_ABLATION_SPEC}],
  {onConflict:'id',ignoreDuplicates:true});
 await d.store.insert('props_lab_events',[{experiment_id:EXP,event:'registered',actor:'system:lab',
  detail:{specSha256:SPORTS_ABLATION.sha256,artifactSha256:d.lab.artifactSha256,forwardStartsAt:SPORTS_ABLATION_SPEC.forwardStartsAt}}]);
 return 'OK';
}

type Obs={id:number;provider_event_id:string;home_team:string;away_team:string;lock_at:string;ingested_at:string;player_name:string;stat:Stat;line:number};
type Pred={id:number;observation_id:number;athlete_id:string|null;p_more:number;p_less:number;p_tie:number;mean:number|null;inputs:Record<string,unknown>};
type PG={espn_event_id:string;athlete_id:string;team_abbr:string;opponent_abbr:string;game_start:string;game_status:string;did_not_play:boolean;
 minutes:number|null;points:number|null;rebounds:number|null;assists:number|null;revision:number;retrieved_at:string};
const PG_COLS='espn_event_id,athlete_id,team_abbr,opponent_abbr,game_start,game_status,did_not_play,minutes,points,rebounds,assists,revision,retrieved_at';

/** Box-score rows the database held at `cutoff` (latest revision retrieved by then), final games only. */
export function asOf(rows:PG[],cutoff:string):PG[]{
 const t=Date.parse(cutoff),m=new Map<string,PG>();
 for(const r of rows){if(Date.parse(r.retrieved_at)>t||Date.parse(r.game_start)>=t)continue;
  const k=r.espn_event_id+'|'+r.athlete_id,p=m.get(k);if(!p||r.revision>p.revision)m.set(k,r);}
 return [...m.values()].filter(r=>r.game_status==='final');
}
const toLog=(r:PG):GameLog=>({gameStart:r.game_start,didNotPlay:r.did_not_play,minutes:r.minutes===null?null:Number(r.minutes),
 points:r.points,rebounds:r.rebounds,assists:r.assists});
const toTeam=(r:PG):TeamGameRow=>({espnEventId:r.espn_event_id,teamAbbr:r.team_abbr,opponentAbbr:r.opponent_abbr,gameStart:r.game_start,
 minutes:r.minutes===null?null:Number(r.minutes),points:r.points,rebounds:r.rebounds,assists:r.assists,didNotPlay:r.did_not_play});
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;

export async function runFreeze(d:LabDeps){
 if(!verifyLabArtifact(d.lab))return {status:'ARTIFACT_INVALID'};
 const reg=await ensureRegistered(d);if(reg!=='OK')return {status:reg};
 const now=d.now(),nowMs=Date.parse(now);
 if(nowMs<Date.parse(SPORTS_ABLATION_SPEC.forwardStartsAt))return {status:'BEFORE_FORWARD_START'};
 const obs=(await paged<Obs>(d.store,'props_observations','select=id,provider_event_id,home_team,away_team,lock_at,ingested_at,player_name,stat,line'+
  '&lock_at=gt.'+q(new Date(nowMs+LOCK_MARGIN_MS).toISOString())+'&ingested_at=gte.'+q(new Date(nowMs-36*3600_000).toISOString())+'&order=id.asc'))
  .filter(o=>Date.parse(o.ingested_at)>=Date.parse(SPORTS_ABLATION_SPEC.forwardStartsAt));
 if(!obs.length)return {status:'OK',frozen:0,flagged:0,lines:0};
 const done=new Set((await byIds<{observation_id:number}>(d.store,'props_lab_predictions','observation_id','observation_id',obs.map(o=>o.id),
  '&experiment_id=eq.'+EXP)).map(r=>Number(r.observation_id)));
 const todo=obs.filter(o=>!done.has(o.id));
 if(!todo.length)return {status:'OK',frozen:0,flagged:0,lines:obs.length,alreadyFrozen:done.size};
 const preds=await byIds<Pred>(d.store,'props_predictions','id,observation_id,athlete_id,p_more,p_less,p_tie,mean,inputs','observation_id',todo.map(o=>o.id),
  '&model_version=eq.'+MODEL_VERSION+'&status=eq.scored');
 const predOf=new Map(preds.map(p=>[Number(p.observation_id),p]));
 let views:{observation_id:number;p_more_books:number|null}[]=[];
 try{views=await byIds(d.store,'props_market_views','observation_id,p_more_books','observation_id',todo.map(o=>o.id));}catch{/* market not migrated: unknown */}
 const books=new Map(views.map(v=>[Number(v.observation_id),v.p_more_books===null?null:Number(v.p_more_books)]));
 // Production recorded picks per game at freeze time (pre-lock exposure), for the same-game flag.
 const picks=preds.length?await byIds<{prediction_id:number;status:string}>(d.store,'props_picks','prediction_id,status','prediction_id',preds.map(p=>p.id),'&status=eq.recorded'):[];
 const pickedObs=new Set(picks.map(p=>preds.find(x=>x.id===Number(p.prediction_id))?.observation_id).filter((x):x is number=>x!==undefined).map(Number));
 const perGame=new Map<string,number>();for(const o of todo)if(pickedObs.has(o.id))perGame.set(o.provider_event_id,(perGame.get(o.provider_event_id)??0)+1);
 const from=new Date(Math.max(Date.parse(d.seasonStart),nowMs-120*DAY)).toISOString();
 const teamPg=await paged<PG>(d.store,'props_player_games','select='+PG_COLS+'&game_start=gte.'+q(from)+'&order=id.asc',40);
 const byAthlete=new Map<string,PG[]>();for(const r of teamPg)byAthlete.set(r.athlete_id,[...(byAthlete.get(r.athlete_id)??[]),r]);
 const roleParams:ModelParams={...d.model.params,roleChange:{...ROLE_CHANGE}};
 const labRows:Record<string,unknown>[]=[],flagRows:Record<string,unknown>[]=[];
 const skipped:Record<string,number>={};
 const skip=(why:string)=>{skipped[why]=(skipped[why]??0)+1;};
 for(const o of todo){
  const p=predOf.get(o.id);if(!p||!p.athlete_id){skip('no_layer1_forecast');continue;}
  const team=typeof p.inputs?.team==='string'?p.inputs.team as string:null;
  const home=teamAbbr(o.home_team),away=teamAbbr(o.away_team);
  if(!team||!home||!away||(team!==home&&team!==away)){skip('team_unknown');continue;}
  const cutoff=o.ingested_at;
  const matchup=matchupFeatures({teamAbbr:team,opponentAbbr:team===home?away:home,home:team===home,lockAt:cutoff,stat:o.stat,rows:asOf(teamPg,cutoff).map(toTeam)});
  const pr=d.model.players[p.athlete_id]??null;
  const logs=asOf(byAthlete.get(p.athlete_id)??[],cutoff).sort((a,b)=>a.game_start.localeCompare(b.game_start)).map(toLog);
  const role=predictLine({logs,prior:pr,stat:o.stat,line:Number(o.line),cutoff,params:roleParams});
  const base={pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)};
  const input:SportsLabInput={base,role:role.status==='scored'?{pMore:role.pMore,pLess:role.pLess,pTie:role.pTie}:null,matchup,booksPMore:books.get(o.id)??null};
  for(const v of SPORTS_ABLATION_SPEC.variants){
   const out=predictVariant(d.lab.artifact.variants[v.id],o.stat,input);if(!out)continue;
   labRows.push({experiment_id:EXP,spec_sha256:SPORTS_ABLATION.sha256,variant_id:v.id,observation_id:o.id,p_more:out.pMore,p_less:out.pLess,p_tie:out.pTie,
    data_cutoff:cutoff,inputs:v.id==='combined'?{matchup,books:input.booksPMore,roleExpMinutes:role.status==='scored'?role.inputs.expMinutes:null}:{}});
  }
  const flags=riskFlags({stat:o.stat,probs:base,line:Number(o.line),mean:num(p.mean===null?null:Number(p.mean)),
   layer1:{games:num(p.inputs.games)??0,expMinutes:num(p.inputs.expMinutes),sdMinutes:num(p.inputs.sdMinutes),
    lastPlayed:typeof p.inputs.lastPlayed==='string'?p.inputs.lastPlayed:null,cutoff},
   roleExpMinutes:role.status==='scored'?role.inputs.expMinutes:null,booksPMore:input.booksPMore,sameGamePicks:perGame.get(o.provider_event_id)??0,
   calibration:d.lab.calibrationTable});
  flagRows.push({experiment_id:EXP,observation_id:o.id,rules_version:RISK_RULES_V1.version,flags,data_cutoff:cutoff,
   inputs:{games:num(p.inputs.games),expMinutes:num(p.inputs.expMinutes),sdMinutes:num(p.inputs.sdMinutes),books:input.booksPMore}});
 }
 let frozen=0,flagged=0,refused=0;
 // Row by row inside each chunk would be slow; a chunk that crosses a lock is refused whole and retried per row.
 const write=async(table:string,rows:Record<string,unknown>[])=>{
  let n=0;
  for(const part of chunk(rows,200)){
   try{await d.store.insert(table,part,{onConflict:table==='props_lab_predictions'?'experiment_id,variant_id,observation_id':'experiment_id,observation_id,rules_version',ignoreDuplicates:true});n+=part.length;}
   catch(e){
    if(!(e instanceof PropsStoreError&&e.refused))throw e;
    for(const r of part){try{await d.store.insert(table,[r],{ignoreDuplicates:true});n++;}catch(x){if(x instanceof PropsStoreError&&x.refused)refused++;else throw x;}}
   }
  }
  return n;
 };
 frozen=await write('props_lab_predictions',labRows);
 flagged=await write('props_lab_flags',flagRows);
 const summary={lines:obs.length,newLines:todo.length,frozen,flagged,refused,skipped,paidRequests:0};
 await d.store.insert('props_lab_events',[{experiment_id:EXP,event:'freeze_run',actor:'system:lab',detail:summary}]);
 return {status:'OK',...summary};
}

type LabPred={variant_id:string;observation_id:number;p_more:number;p_less:number;p_tie:number;predicted_at:string};
type Res={observation_id:number;revision:number;outcome:string;actual:number|null;player_game_id:number|null};

export async function runReport(d:LabDeps){
 const reg=await ensureRegistered(d);if(reg!=='OK')return {status:reg};
 const now=d.now();
 const preds=await paged<LabPred>(d.store,'props_lab_predictions','select=variant_id,observation_id,p_more,p_less,p_tie,predicted_at&experiment_id=eq.'+EXP+'&order=id.asc',60);
 const obsIds=[...new Set(preds.map(p=>Number(p.observation_id)))];
 const [obs,results,flags]=obsIds.length?await Promise.all([
  byIds<Obs>(d.store,'props_observations','id,provider_event_id,home_team,away_team,lock_at,ingested_at,player_name,stat,line','id',obsIds),
  byIds<Res>(d.store,'props_line_results','observation_id,revision,outcome,actual,player_game_id','observation_id',obsIds),
  byIds<{observation_id:number;flags:RiskFlag[]}>(d.store,'props_lab_flags','observation_id,flags','observation_id',obsIds,'&experiment_id=eq.'+EXP)]):[[],[],[]];
 const latest=new Map<number,Res>();for(const r of results){const p=latest.get(Number(r.observation_id));if(!p||r.revision>p.revision)latest.set(Number(r.observation_id),r);}
 const obsOf=new Map(obs.map(o=>[Number(o.id),o]));
 const flagOf=new Map(flags.map(f=>[Number(f.observation_id),f.flags]));
 const predsOf=new Map<number,Record<string,{pMore:number;pLess:number;pTie:number}>>();
 for(const p of preds){const m=predsOf.get(Number(p.observation_id))??{};m[p.variant_id]={pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)};predsOf.set(Number(p.observation_id),m);}
 // Production layer-1 forecast and its actual pick (if any) for the same lines, for diagnosis and flag evaluation.
 const l1=obsIds.length?await byIds<Pred>(d.store,'props_predictions','id,observation_id,athlete_id,p_more,p_less,p_tie,mean,inputs','observation_id',obsIds,'&model_version=eq.'+MODEL_VERSION):[];
 const picks=l1.length?await byIds<{prediction_id:number;status:string;side:'more'|'less'|null}>(d.store,'props_picks','prediction_id,status,side','prediction_id',l1.map(p=>p.id),'&status=eq.recorded'):[];
 const pickOf=new Map(picks.map(k=>[Number(l1.find(p=>p.id===Number(k.prediction_id))?.observation_id),k.side]));
 const l1Of=new Map(l1.map(p=>[Number(p.observation_id),p]));
 const gameIds=[...latest.values()].map(r=>r.player_game_id).filter((x):x is number=>x!==null);
 const minutes=new Map((gameIds.length?await byIds<{id:number;minutes:number|null}>(d.store,'props_player_games','id,minutes','id',gameIds):[]).map(r=>[Number(r.id),r.minutes===null?null:Number(r.minutes)]));
 const rows:LabRow[]=[];const graded:GradedPick[]=[];
 let pending=0,voided=0;
 const keyOf=(o:Obs)=>[o.provider_event_id,o.player_name.toLowerCase(),o.stat,Number(o.line)].join('|');
 for(const id of obsIds){
  const o=obsOf.get(id),r=latest.get(id),p=predsOf.get(id);if(!o||!p)continue;
  if(!r){pending++;continue;}
  if(r.outcome!=='more'&&r.outcome!=='less'&&r.outcome!=='tie'){voided++;continue;}
  rows.push({key:keyOf(o),cluster:o.provider_event_id,date:etDate(o.lock_at),stat:o.stat,outcome:r.outcome,preds:p});
  const side=pickOf.get(id),lp=l1Of.get(id);
  if(side&&r.outcome!=='tie'&&lp){
   const alt=(v:string)=>{const x=p[v];if(!x)return null;const dd=decidePick({status:'scored',...x});return dd.status==='recorded'?dd.side:null;};
   graded.push({key:keyOf(o),stat:o.stat,side,correct:side===r.outcome,probability:Math.max(Number(lp.p_more),Number(lp.p_less))/(1-Number(lp.p_tie)||1),
    expMinutes:num(lp.inputs?.expMinutes),actualMinutes:r.player_game_id?minutes.get(Number(r.player_game_id))??null:null,mean:lp.mean===null?null:Number(lp.mean),
    actual:r.actual===null?null:Number(r.actual),line:Number(o.line),booksPMore:null,oppAllowedRatio:null,flags:flagOf.get(id)??[],
    alternatives:{'base+recalibration':alt('base+recalibration'),combined:alt('combined')}});
  }
 }
 const comparison=compareVariants(SPORTS_ABLATION_SPEC,rows,'forward');
 const report={asOf:now,experimentId:EXP,specSha256:SPORTS_ABLATION.sha256,evidence:'forward',progress:{frozenLines:obsIds.length,graded:rows.length,pending,voided},
  comparison,riskFlags:{rules:RISK_RULES_V1,coverageGaps:COVERAGE_GAPS,selectedPicks:graded.length,effects:flagEffectiveness(graded.map(g=>({flags:g.flags,correct:g.correct})))},
  mistakes:diagnoseMistakes(graded),costs:{paidRequests:0,note:'The lab reuses stored lines and sportsbook quotes; it makes no provider requests.'},
  promotion:{automatic:false,note:'The lab never switches models. A layer that passes here becomes a candidate for the existing props-learn shadow path and owner review.'}};
 await d.store.insert('props_lab_reports',[{experiment_id:EXP,kind:'forward_comparison',as_of:now,report}]);
 // A layer verdict is recorded once, and only after the registered forward sample minimums are met.
 const events=await d.store.select<{event:string;detail:{layer?:string}}>('props_lab_events','select=event,detail&experiment_id=eq.'+EXP+'&event=in.(layer_accepted,layer_rejected)&limit=1000');
 const decided=new Set(events.map(e=>e.detail?.layer));
 const verdicts=comparison.layers.filter(l=>(l.verdict==='helps'||l.verdict==='hurts'||l.verdict==='no_clear_effect')&&comparison.sampleMinimumsMet&&!decided.has(l.layer));
 if(verdicts.length)await d.store.insert('props_lab_events',verdicts.map(l=>({experiment_id:EXP,event:l.verdict==='helps'?'layer_accepted':'layer_rejected',actor:'system:lab',
  detail:{layer:l.layer,verdict:l.verdict,explanation:l.explanation,n:comparison.n}})));
 await d.store.insert('props_lab_events',[{experiment_id:EXP,event:'report',actor:'system:lab',detail:{graded:rows.length,pending,picks:graded.length}}]);
 return {status:'OK',graded:rows.length,pending,voided,picks:graded.length,sampleMinimumsMet:comparison.sampleMinimumsMet,
  layers:Object.fromEntries(comparison.layers.map(l=>[l.layer,l.verdict]))};
}
