/**
 * AI 2.0 learning engine runner (research only).
 *   node --experimental-strip-types scripts/research-engine.ts --registry research/engine/registry.json --out <dir>
 *        [--sports-ledger] [--sports-rows rows.json] [--stock-weeks weeks.json] [--result results.json] [--now ISO]
 *
 * Reads newly graded outcomes (GET-only from the props ledger, host-pinned; or an offline JSON file), checks data
 * quality, measures patterns with clustered uncertainty, proposes at most 2 new hypotheses per domain (never one
 * already rejected or under test), applies registered research results to experiment statuses, and writes a report
 * and an UPDATED COPY of the registry to --out. It never writes to a database, never calls a provider, broker or
 * AI service, and cannot change a model, pick, entry, stake, budget, schedule or order.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fingerprint,register,transition,type Experiment,type Registry} from '../src/lib/lab/engine/experiments.ts';
import {sportsQuality,sportsPatterns,stockPatterns,proposeHypotheses,hitSummary,type SportsRow,type StockWeek,type Hypothesis} from '../src/lib/lab/engine/diagnostics.ts';
import {nextStatus,type Result} from '../src/lib/lab/engine/evaluate.ts';
import {REVIEW_GATE} from '../src/lib/props/promotion.ts';
import {MODEL_VERSION} from '../src/lib/props/contract.ts';

const argv=process.argv;
const opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
const flag=(n:string)=>argv.includes('--'+n);
const now=opt('now')??new Date().toISOString();
const LIMITS={maxNewHypothesesPerDomain:2,maxRows:20000,maxRuntimeMs:5*60_000};
const t0=Date.now();

async function ledgerRows():Promise<SportsRow[]>{
 const url=process.env.SPORTSEDGE_PROPS_SUPABASE_URL??'',key=process.env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY??'';
 let host=null;try{host=new URL(url).hostname;}catch{/* checked below */}
 if(!key||host!=='vfyzbliksooljxrlfadp.supabase.co')throw new Error('NOT_CONFIGURED_OR_UNEXPECTED_PROJECT');
 const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),Accept:'application/json'};
 const get=async(path:string)=>{const r=await fetch(`https://${host}/rest/v1/${path}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20_000)});
  if(!r.ok)throw new Error('HTTP_'+r.status);return r.json();};
 const ids=(xs:unknown[])=>[...new Set(xs.map(Number))];
 const byIds=async(t:string,sel:string,col:string,v:number[])=>{const out=[];for(let i=0;i<v.length;i+=150)out.push(...await get(`${t}?select=${sel}&${col}=in.(${v.slice(i,i+150).join(',')})&limit=10000`));return out;};
 const obs=await get('props_observations?select=id,provider_event_id,lock_at,player_name,stat,line&lock_at=gte.2026-11-01&order=id.asc&limit=10000');
 const preds=await byIds('props_predictions','id,observation_id,model_version,status,p_more,p_less,mean,inputs,predicted_at','observation_id',ids(obs.map((o:{id:number})=>o.id)));
 const active=preds.filter((p:{model_version:string;status:string})=>p.model_version===MODEL_VERSION&&p.status==='scored');
 const [picks,results,views]=await Promise.all([
  byIds('props_picks','prediction_id,status,side','prediction_id',ids(active.map((p:{id:number})=>p.id))),
  byIds('props_line_results','observation_id,revision,outcome,graded_at','observation_id',ids(obs.map((o:{id:number})=>o.id))),
  byIds('props_market_views','observation_id,p_more_books','observation_id',ids(obs.map((o:{id:number})=>o.id))).catch(()=>[])]);
 const o=new Map(obs.map((x:{id:number})=>[Number(x.id),x])),pick=new Map(picks.map((x:{prediction_id:number})=>[Number(x.prediction_id),x])),
  view=new Map(views.map((x:{observation_id:number})=>[Number(x.observation_id),x]));
 const latest=new Map<number,{outcome:string;graded_at:string;revision:number}>();
 for(const r of results){const k=Number(r.observation_id),prev=latest.get(k);if(!prev||r.revision>prev.revision)latest.set(k,r);}
 const rows:SportsRow[]=[];const seen=new Set<string>();
 for(const p of [...active].sort((a:{id:number},b:{id:number})=>a.id-b.id)){
  const ob=o.get(Number(p.observation_id)) as {id:number;provider_event_id:string;lock_at:string;player_name:string;stat:string;line:number}|undefined;
  const res=latest.get(Number(p.observation_id));if(!ob||!res||(res.outcome!=='more'&&res.outcome!=='less'))continue;
  const key=[ob.provider_event_id,ob.player_name.toLowerCase(),ob.stat,Number(ob.line)].join('|');if(seen.has(key))continue;seen.add(key);
  const pm=Number(p.p_more)/(Number(p.p_more)+Number(p.p_less)),pk=pick.get(Number(p.id)) as {status:string;side:'more'|'less'}|undefined;
  const inp=p.inputs??{},v=view.get(Number(p.observation_id)) as {p_more_books:number|null}|undefined;
  const picked=pk?.status==='recorded'?pk.side:null;
  rows.push({key,game:ob.provider_event_id,date:ob.lock_at.slice(0,10),stat:ob.stat,predictedAt:p.predicted_at,lockAt:ob.lock_at,gradedAt:res.graded_at,
   pMore:pm,outcome:res.outcome as 'more'|'less',picked,modelVersion:p.model_version,
   lineGapRel:Number.isFinite(Number(p.mean))?Math.abs(Number(p.mean)-Number(ob.line))/Math.max(1,Number(ob.line)):null,
   minutesCv:Number(inp.expMinutes)>0?Number(inp.sdMinutes)/Number(inp.expMinutes):null,games:Number.isFinite(Number(inp.games))?Number(inp.games):null,
   booksAgree:v?.p_more_books==null||!picked?null:(picked==='more')===(Number(v.p_more_books)>=0.5)});
 }
 return rows;
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

const regPath=opt('registry');if(!regPath)throw new Error('missing --registry');
const out=opt('out');if(!out)throw new Error('missing --out');
let reg:Registry=JSON.parse(readFileSync(regPath,'utf8'));
const report:Record<string,unknown>={generatedBy:'scripts/research-engine.ts',at:now,limits:LIMITS,
 guarantees:['GET-only reads; no database writes; no provider, broker or AI calls','No model, pick, entry, stake, budget, schedule or order can change',
  'Rejected ideas are never re-proposed; at most 2 new hypotheses per domain per run'],domains:{}};

// Sports
const sportsInput:SportsRow[]|null=flag('sports-ledger')?await ledgerRows():opt('sports-rows')?JSON.parse(readFileSync(opt('sports-rows')!,'utf8')):null;
if(sportsInput){
 if(sportsInput.length>LIMITS.maxRows)throw new Error('ROW_LIMIT');
 const {clean,issues}=sportsQuality(sportsInput,now);
 const patterns=sportsPatterns(clean);
 const fp=fingerprint(clean.map(r=>r.key).sort());
 const prop=proposeHypotheses(patterns,reg,LIMITS.maxNewHypothesesPerDomain);
 for(const h of prop.proposed)reg=register(reg,newExperiment(h,fp),now);
 (report.domains as Record<string,unknown>).sports={inputFingerprint:fp,rows:sportsInput.length,clean:clean.length,
  qualityIssues:issues.reduce((m:Record<string,number>,i)=>{m[i.code]=(m[i.code]??0)+1;return m;},{}),
  picks:hitSummary(clean),patterns,proposed:prop.proposed,skipped:prop.skipped};
}
// Stocks
if(opt('stock-weeks')){
 const weeks:StockWeek[]=JSON.parse(readFileSync(opt('stock-weeks')!,'utf8'));
 const patterns=stockPatterns(weeks);const prop=proposeHypotheses(patterns,reg,LIMITS.maxNewHypothesesPerDomain);
 const fp=fingerprint(weeks);
 for(const h of prop.proposed)reg=register(reg,newExperiment(h,fp),now);
 (report.domains as Record<string,unknown>).stocks={inputFingerprint:fp,weeks:weeks.length,patterns,proposed:prop.proposed,skipped:prop.skipped};
}
// Registered research results → lifecycle (idempotent per result fingerprint)
if(opt('result')){
 const results:{experimentId:string;result:Result}[]=JSON.parse(readFileSync(opt('result')!,'utf8'));
 const applied=[];
 for(const x of results){
  const e=reg.experiments.find(y=>y.id===x.experimentId);if(!e){applied.push({id:x.experimentId,error:'UNKNOWN_EXPERIMENT'});continue;}
  const n=nextStatus(e,x.result);const r=transition(reg,e.id,n.to,n.reason,now,fingerprint(x),x.result as unknown as Record<string,unknown>,x.result.disposition);
  reg=r.registry;applied.push({id:e.id,from:e.status,to:n.to,changed:r.changed,reason:n.reason});
 }
 report.applied=applied;
}
report.registrySummary=reg.experiments.map(e=>({id:e.id,domain:e.domain,status:e.status,disposition:e.disposition}));
report.runtimeMs=Date.now()-t0;
if(Date.now()-t0>LIMITS.maxRuntimeMs)throw new Error('RUNTIME_LIMIT');
mkdirSync(out,{recursive:true});
writeFileSync(out+'/registry.json',JSON.stringify(reg,null,1)+'\n');
writeFileSync(out+'/report.json',JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify({status:'OK',registry:out+'/registry.json',experiments:reg.experiments.length,
 proposed:Object.fromEntries(Object.entries(report.domains as Record<string,{proposed?:Hypothesis[]}>).map(([k,v])=>[k,(v.proposed??[]).map(h=>h.key)]))}));
