/**
 * AI 2.0 learning engine runner (research only): one complete, idempotent learning cycle.
 *   node --experimental-strip-types scripts/research-engine.ts --registry research/engine/registry.json --out <dir>
 *        [--state <dir>] [--sports-ledger | --sports-rows rows.json --forward-input fwd.json] [--stock-weeks weeks.json]
 *        [--result results.json] [--evaluate-forward] [--now ISO]
 *
 * 1 read newly graded outcomes and frozen predictions (GET-only from the props ledger, host-pinned; or offline JSON)
 * 2 check integrity and timestamps (bad rows excluded and counted)   3 diagnose with clustered uncertainty
 * 4 propose at most 2 hypotheses per domain, never one already rejected or under test (register them as PROPOSED)
 * 5 evaluate registered forward experiments from frozen predictions with the production review gate
 * 6 apply results to statuses (REJECTED / continue / READY_FOR_REVIEW — never promotion)
 * 7 write the registry, the report and an append-only run history to --out (and --state for the next run).
 * A repeat run on the same data changes nothing. It never writes to a database, never calls a provider, broker or
 * AI service, and cannot change a model, pick, entry, stake, budget, schedule or order.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync} from 'node:fs';
import {fingerprint,register,transition,type Experiment,type Registry} from '../src/lib/lab/engine/experiments.ts';
import {sportsQuality,sportsPatterns,stockPatterns,proposeHypotheses,hitSummary,type SportsRow,type StockWeek,type Hypothesis} from '../src/lib/lab/engine/diagnostics.ts';
import {nextStatus,type Result} from '../src/lib/lab/engine/evaluate.ts';
import {pair,forwardResult,type FrozenPrediction,type Grade} from '../src/lib/lab/engine/forward.ts';
import {REVIEW_GATE} from '../src/lib/props/promotion.ts';
import {MODEL_VERSION} from '../src/lib/props/contract.ts';

const argv=process.argv;
const opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
const flag=(n:string)=>argv.includes('--'+n);
const now=opt('now')??new Date().toISOString();
export const LIMITS={maxNewHypothesesPerDomain:2,maxRows:20000,maxRuntimeMs:5*60_000,maxLedgerRequests:Number(process.env.ENGINE_MAX_REQUESTS??80),maxForwardEvaluations:5};
const t0=Date.now();
const out=opt('out');if(!out)throw new Error('missing --out');
const state=opt('state');
mkdirSync(out,{recursive:true});
const runId=fingerprint({now,argv:argv.slice(2)}).slice(0,16);

class Budget extends Error{constructor(){super('BUDGET_EXHAUSTED');this.name='Budget';}}

type Ledger={rows:SportsRow[];preds:FrozenPrediction[];grades:Grade[];requests:number};
async function readLedger():Promise<Ledger>{
 const url=process.env.SPORTSEDGE_PROPS_SUPABASE_URL??'',key=process.env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY??'';
 let host=null;try{host=new URL(url).hostname;}catch{/* checked below */}
 if(!key||host!=='vfyzbliksooljxrlfadp.supabase.co')throw new Error('NOT_CONFIGURED_OR_UNEXPECTED_PROJECT');
 const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),Accept:'application/json'};
 let requests=0;
 const get=async(path:string)=>{if(++requests>LIMITS.maxLedgerRequests)throw new Budget();
  const r=await fetch(`https://${host}/rest/v1/${path}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20_000)});
  if(!r.ok)throw new Error('HTTP_'+r.status);return r.json();};
 const ids=(xs:unknown[])=>[...new Set(xs.map(Number))];
 const byIds=async(t:string,sel:string,col:string,v:number[])=>{const o=[];for(let i=0;i<v.length;i+=150)o.push(...await get(`${t}?select=${sel}&${col}=in.(${v.slice(i,i+150).join(',')})&limit=10000`));return o;};
 const obs=await get('props_observations?select=id,provider_event_id,lock_at,player_name,stat,line&lock_at=gte.2026-11-01&order=id.asc&limit=10000');
 const oids=ids(obs.map((o:{id:number})=>o.id));
 const preds=await byIds('props_predictions','id,observation_id,model_version,status,p_more,p_less,p_tie,mean,inputs,predicted_at','observation_id',oids);
 const scored=preds.filter((p:{status:string})=>p.status==='scored');
 const active=scored.filter((p:{model_version:string})=>p.model_version===MODEL_VERSION);
 const [picks,results,views]=await Promise.all([
  byIds('props_picks','prediction_id,status,side','prediction_id',ids(active.map((p:{id:number})=>p.id))),
  byIds('props_line_results','observation_id,revision,outcome,graded_at','observation_id',oids),
  byIds('props_market_views','observation_id,p_more_books','observation_id',oids).catch(e=>{if(e instanceof Budget)throw e;return [];})]);
 const o=new Map(obs.map((x:{id:number})=>[Number(x.id),x])),pick=new Map(picks.map((x:{prediction_id:number})=>[Number(x.prediction_id),x])),
  view=new Map(views.map((x:{observation_id:number})=>[Number(x.observation_id),x]));
 const latest=new Map<number,{outcome:string;graded_at:string;revision:number}>();
 for(const r of results){const k=Number(r.observation_id),prev=latest.get(k);if(!prev||r.revision>prev.revision)latest.set(k,r);}
 type Ob={id:number;provider_event_id:string;lock_at:string;player_name:string;stat:string;line:number};
 const keyOf=(ob:Ob)=>[ob.provider_event_id,ob.player_name.toLowerCase(),ob.stat,Number(ob.line)].join('|');
 const rows:SportsRow[]=[],seen=new Set<string>(),fp:FrozenPrediction[]=[],grades=new Map<string,Grade>();
 for(const p of [...scored].sort((a:{id:number},b:{id:number})=>a.id-b.id)){
  const ob=o.get(Number(p.observation_id)) as Ob|undefined;if(!ob)continue;
  const key=keyOf(ob);
  fp.push({key,eventId:ob.provider_event_id,date:ob.lock_at.slice(0,10),stat:ob.stat as FrozenPrediction['stat'],model:p.model_version,predictedAt:p.predicted_at,lockAt:ob.lock_at,
   p:{pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)}});
  const res=latest.get(Number(p.observation_id));
  if(res&&['more','less','tie'].includes(res.outcome))grades.set(key,{key,outcome:res.outcome as Grade['outcome']});
  if(p.model_version!==MODEL_VERSION||!res||(res.outcome!=='more'&&res.outcome!=='less')||seen.has(key))continue;
  seen.add(key);
  const pm=Number(p.p_more)/(Number(p.p_more)+Number(p.p_less)),pk=pick.get(Number(p.id)) as {status:string;side:'more'|'less'}|undefined;
  const inp=p.inputs??{},v=view.get(Number(p.observation_id)) as {p_more_books:number|null}|undefined,picked=pk?.status==='recorded'?pk.side:null;
  rows.push({key,game:ob.provider_event_id,date:ob.lock_at.slice(0,10),stat:ob.stat,predictedAt:p.predicted_at,lockAt:ob.lock_at,gradedAt:res.graded_at,
   pMore:pm,outcome:res.outcome as 'more'|'less',picked,modelVersion:p.model_version,
   lineGapRel:Number.isFinite(Number(p.mean))?Math.abs(Number(p.mean)-Number(ob.line))/Math.max(1,Number(ob.line)):null,
   minutesCv:Number(inp.expMinutes)>0?Number(inp.sdMinutes)/Number(inp.expMinutes):null,games:Number.isFinite(Number(inp.games))?Number(inp.games):null,
   booksAgree:v?.p_more_books==null||!picked?null:(picked==='more')===(Number(v.p_more_books)>=0.5)});
 }
 return {rows,preds:fp,grades:[...grades.values()],requests};
}

function newExperiment(h:Hypothesis,dataFp:string):Experiment{
 const sports=h.domain==='sports';
 return {id:`${h.domain}-${h.idea}-${now.slice(0,10)}`,domain:h.domain,hypothesisKey:h.key,hypothesis:h.statement,
  dataDependencies:sports?['props ledger (pre-lock predictions, graded results)','pinned ESPN box scores']:['Alpaca daily bars (read-only)'],
  frozen:{features:[],parameters:{idea:h.idea,motivatedBy:h.motivatedBy,evidence:h.evidence}},dataCutoff:now,
  codeFingerprint:'pending: the challenger spec is frozen when implemented',datasetFingerprints:[{name:'diagnostic input',sha256:dataFp}],
  metrics:sports?{primary:'brier',secondary:['logLoss','ece','qualified-pick hit rate']}:{primary:'weekly excess return',secondary:['sharpe','max drawdown','turnover']},
  sampleRequirements:sports?{minObservations:REVIEW_GATE.minGradedLines,minDates:REVIEW_GATE.minDates,minClusters:REVIEW_GATE.minGames,minDecisions:REVIEW_GATE.minCandidateDecisions}:{minObservations:26,minWeeks:26},
  baseline:sports?MODEL_VERSION:'stock-v2-weekly-1',costAssumptions:sports?null:'10 bps per side, 25 bps sensitivity',
  decisionRule:'Pre-registered when the challenger spec is frozen; Holm across the family; never automatic promotion.',
  status:'PROPOSED',result:null,disposition:null,source:'engine',registeredAt:now,history:[]};
}

const report:Record<string,unknown>={generatedBy:'scripts/research-engine.ts',runId,at:now,limits:LIMITS,
 guarantees:['GET-only reads; no database writes; no provider, broker or AI calls','No model, pick, entry, stake, budget, schedule or order can change',
  'Rejected ideas are never re-proposed; at most 2 new hypotheses per domain per run','READY_FOR_REVIEW waits for the owner; nothing is promoted'],domains:{},forward:[],applied:[]};
const regIn=state&&existsSync(state+'/registry.json')?state+'/registry.json':opt('registry');
if(!regIn)throw new Error('missing --registry');
let reg:Registry=JSON.parse(readFileSync(regIn,'utf8'));
const before=fingerprint(reg);
let status='OK',failure:string|null=null;

try{
 let ledger:Ledger|null=null;
 if(flag('sports-ledger'))ledger=await readLedger();
 else if(opt('sports-rows')){
  const fwd=opt('forward-input')?JSON.parse(readFileSync(opt('forward-input')!,'utf8')):{predictions:[],grades:[]};
  ledger={rows:JSON.parse(readFileSync(opt('sports-rows')!,'utf8')),preds:fwd.predictions,grades:fwd.grades,requests:0};
 }
 if(ledger){
  if(ledger.rows.length>LIMITS.maxRows)throw new Error('ROW_LIMIT');
  const {clean,issues}=sportsQuality(ledger.rows,now);
  const patterns=sportsPatterns(clean);
  const fp=fingerprint(clean.map(r=>r.key).sort());
  const prop=proposeHypotheses(patterns,reg,LIMITS.maxNewHypothesesPerDomain);
  for(const h of prop.proposed)reg=register(reg,newExperiment(h,fp),now);
  (report.domains as Record<string,unknown>).sports={inputFingerprint:fp,rows:ledger.rows.length,clean:clean.length,ledgerRequests:ledger.requests,
   qualityIssues:issues.reduce((m:Record<string,number>,i)=>{m[i.code]=(m[i.code]??0)+1;return m;},{}),
   picks:hitSummary(clean),patterns,proposed:prop.proposed,skipped:prop.skipped};
  if(flag('evaluate-forward')){
   const due=reg.experiments.filter(e=>e.forward&&!['REJECTED','READY_FOR_REVIEW'].includes(e.status)).slice(0,LIMITS.maxForwardEvaluations);
   for(const e of due){
    const rep=pair(e.forward!,ledger.preds,ledger.grades);
    const res=forwardResult(e.forward!,rep,now);
    const n=nextStatus(e,res);
    const inFp=fingerprint({spec:e.forward,rows:rep.rows.map(r=>[r.key,r.outcome]),stale:res.details.stale});
    const t=transition(reg,e.id,n.to,n.reason,now,inFp,res.details,res.disposition);reg=t.registry;
    (report.forward as unknown[]).push({id:e.id,from:e.status,to:n.to,changed:t.changed,reason:n.reason,details:res.details});
   }
  }
 }
 if(opt('stock-weeks')){
  const weeks:StockWeek[]=JSON.parse(readFileSync(opt('stock-weeks')!,'utf8'));
  const patterns=stockPatterns(weeks);const prop=proposeHypotheses(patterns,reg,LIMITS.maxNewHypothesesPerDomain);
  const fp=fingerprint(weeks);
  for(const h of prop.proposed)reg=register(reg,newExperiment(h,fp),now);
  (report.domains as Record<string,unknown>).stocks={inputFingerprint:fp,weeks:weeks.length,patterns,proposed:prop.proposed,skipped:prop.skipped};
 }
 if(opt('result')){
  const results:{experimentId:string;result:Result}[]=JSON.parse(readFileSync(opt('result')!,'utf8'));
  for(const x of results){
   const e=reg.experiments.find(y=>y.id===x.experimentId);if(!e){(report.applied as unknown[]).push({id:x.experimentId,error:'UNKNOWN_EXPERIMENT'});continue;}
   const n=nextStatus(e,x.result);const r=transition(reg,e.id,n.to,n.reason,now,fingerprint(x),x.result as unknown as Record<string,unknown>,x.result.disposition);
   reg=r.registry;(report.applied as unknown[]).push({id:e.id,from:e.status,to:n.to,changed:r.changed,reason:n.reason});
  }
 }
 if(Date.now()-t0>LIMITS.maxRuntimeMs)throw new Error('RUNTIME_LIMIT');
}catch(e){
 status='FAILED';failure=e instanceof Error?e.message:String(e);
 reg=JSON.parse(readFileSync(regIn,'utf8'));   // a failed run never half-applies changes
}
report.status=status;report.failure=failure;report.registryChanged=fingerprint(reg)!==before;
report.registrySummary=reg.experiments.map(e=>({id:e.id,domain:e.domain,status:e.status,disposition:e.disposition}));
report.runtimeMs=Date.now()-t0;
const run={runId,at:now,status,failure,registryChanged:report.registryChanged,
 proposed:Object.fromEntries(Object.entries(report.domains as Record<string,{proposed?:Hypothesis[]}>).map(([k,v])=>[k,(v.proposed??[]).map(h=>h.key)])),
 forward:(report.forward as {id:string;to:string;changed:boolean}[]).map(f=>({id:f.id,to:f.to,changed:f.changed}))};
for(const dir of new Set([out,...(state?[state]:[])])){
 mkdirSync(dir,{recursive:true});
 writeFileSync(dir+'/registry.json',JSON.stringify(reg,null,1)+'\n');
 writeFileSync(dir+'/report.json',JSON.stringify(report,null,1)+'\n');
 appendFileSync(dir+'/runs.jsonl',JSON.stringify(run)+'\n');
}
console.log(JSON.stringify({...run,experiments:reg.experiments.length}));
if(status!=='OK')process.exitCode=1;
