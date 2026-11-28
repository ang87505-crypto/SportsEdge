/** Replay a locally saved ResearchRaw snapshot. No database, provider client, new forecast, stake or write. */
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {watchOnlyLedger} from '../src/lib/props/watch-only.ts';
import {PLATFORMS,STATS} from '../src/lib/props/contract.ts';
import type {ResearchRaw} from '../src/lib/props/research.ts';

const MAX_BYTES=64*1024*1024,MAX_ROWS=20000;
const collections=['observations','predictions','results','picks','entryLegs'] as const;
function fail(code:string):never{throw new Error('WATCH_REPLAY_'+code);}
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const strings=(r:Record<string,unknown>,fields:string[])=>fields.every(f=>typeof r[f]==='string');
function snapshot(value:unknown):ResearchRaw{
 if(!object(value)||!strings(value,['nowIso','windowStart']))fail('INVALID_SNAPSHOT');
 const data=value as Record<string,unknown>;
 if(!Number.isFinite(Date.parse(data.nowIso as string))||!Number.isFinite(Date.parse(data.windowStart as string))||
  Date.parse(data.windowStart as string)>Date.parse(data.nowIso as string))fail('INVALID_SNAPSHOT');
 for(const name of collections){
  const rows=data[name];if(!Array.isArray(rows)||rows.length>MAX_ROWS||!rows.every(object))fail('INVALID_SNAPSHOT');
 }
 const observations=data.observations as Record<string,unknown>[],predictions=data.predictions as Record<string,unknown>[],
  results=data.results as Record<string,unknown>[];
 const unique=(rows:Record<string,unknown>[],key:(r:Record<string,unknown>)=>unknown)=>{
  if(new Set(rows.map(key)).size!==rows.length)fail('DUPLICATE_IDENTITY');
 };
 for(const o of observations){
  if(!positive(o.id)||!strings(o,['platform','provider_event_id','home_team','away_team','lock_at','player_name','stat',
   'provider_last_update','ingested_at','recorded_at'])||!number(o.line)||
   !(PLATFORMS as readonly unknown[]).includes(o.platform)||!(STATS as readonly unknown[]).includes(o.stat))fail('INVALID_SNAPSHOT');
 }
 for(const p of predictions){
  if(!positive(p.id)||!positive(p.observation_id)||!strings(p,['model_version','status','data_cutoff','predicted_at'])||
   !['scored','unscorable'].includes(p.status as string)||!(p.athlete_id===null||typeof p.athlete_id==='string')||
   ![p.p_more,p.p_less,p.p_tie].every(v=>v===null||number(v)))fail('INVALID_SNAPSHOT');
 }
 for(const g of results){
  if(!positive(g.observation_id)||!positive(g.revision)||!strings(g,['outcome','graded_at'])||
   !['more','less','tie','void_dnp','void_postponed'].includes(g.outcome as string)||
   !(g.actual===null||number(g.actual)&&Number.isInteger(g.actual)&&Number(g.actual)>=0)||
   (['more','less','tie'].includes(g.outcome as string)!==(g.actual!==null)))fail('INVALID_SNAPSHOT');
 }
 unique(observations,o=>o.id);unique(predictions,p=>p.id);
 unique(predictions,p=>String(p.observation_id)+'|'+String(p.model_version));
 unique(results,g=>String(g.observation_id)+'|'+String(g.revision));
 return data as unknown as ResearchRaw;
}

try{
 const options=new Map<string,string>();
 for(let i=2;i<process.argv.length;i+=2){
  const flag=process.argv[i],value=process.argv[i+1];
  if(!['--input','--as-of'].includes(flag)||options.has(flag)||!value||value.startsWith('--'))fail('INVALID_ARGUMENTS');
  options.set(flag,value);
 }
 const input=options.get('--input');if(!input)fail('INVALID_ARGUMENTS');
 if(/^https?:\/\//i.test(input))fail('LOCAL_INPUT_REQUIRED');
 let bytes:Buffer;
 try{
  const info=statSync(input);if(!info.isFile()||info.size>MAX_BYTES)fail('INPUT_LIMIT');
  bytes=readFileSync(input);if(bytes.length>MAX_BYTES)fail('INPUT_LIMIT');
 }catch(e){if(e instanceof Error&&e.message==='WATCH_REPLAY_INPUT_LIMIT')throw e;fail('INPUT_UNAVAILABLE');}
 let value:unknown;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('INVALID_SNAPSHOT');}
 const raw=snapshot(value),asOf=options.get('--as-of')??raw.nowIso,clock=Date.parse(asOf);
 if(!Number.isFinite(clock))fail('INVALID_AS_OF');
 if(clock<Date.parse(raw.windowStart)||clock>Date.parse(raw.nowIso))fail('OUTSIDE_SNAPSHOT_WINDOW');
 const ledger=watchOnlyLedger(raw,new Date(clock).toISOString());
 const unique=ledger.rows.filter(r=>r.isUnique),pushes=unique.filter(r=>r.outcome==='push');
 const ties=pushes.filter(r=>r.gradeOutcome==='tie').length,
  voidDnp=pushes.filter(r=>r.gradeOutcome==='void_dnp').length,
  voidPostponed=pushes.filter(r=>r.gradeOutcome==='void_postponed').length;
 console.log(JSON.stringify({schema:'props-watch-replay-v1',status:'REPLAYED',readOnly:true,
  inputSha256:createHash('sha256').update(bytes).digest('hex'),snapshotAsOf:raw.nowIso,windowStart:raw.windowStart,
  asOf:ledger.asOf,watchVersion:ledger.version,providerRequests:0,databaseRequests:0,ledgerWrites:0,
  sourceCounts:Object.fromEntries(collections.map(name=>[name,raw[name].length])),
  totals:ledger.report(0),atLeast60:ledger.report(.60),
  byPlatform:Object.fromEntries(PLATFORMS.map(p=>[p,ledger.report(0,undefined,p)])),
  gradeKinds:{ties,voids:voidDnp+voidPostponed,voidDnp,voidPostponed},
  observationsExcluded:ledger.invalidRows,duplicateSnapshotsExcluded:ledger.duplicates,rows:ledger.rows}));
}catch(e){
 const code=e instanceof Error&&/^WATCH_REPLAY_[A-Z_]+$/.test(e.message)?e.message:'WATCH_REPLAY_FAILED';
 console.error(code);process.exitCode=2;
}
