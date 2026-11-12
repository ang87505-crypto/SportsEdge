/**
 * Props capture activation preflight (docs/PROPS_CAPTURE_ACTIVATION_CHECKLIST_2026_11_11.md). READ-ONLY:
 * every database request is an HTTP GET through PostgREST (enforced below); it never calls an RPC, the Odds API,
 * or a write endpoint, and prints no secret. It reports whether the capture schema and v3 accounting are applied,
 * the active budget policy, real rolling credit use, duplicate and entry-cap checks, settlement recency, and what
 * the live site's assistant says about the budget, so the dashboard can be compared with the ledger.
 * Usage: node scripts/props-activation-preflight.mjs [out.json]
 */
import {writeFileSync} from 'node:fs';
import {EXPECTED_PROJECT,CAPTURE_TABLES,missingRelation,missingColumn,activePolicy,creditUse,entryCapBreaches,duplicates,verdict} from './props-activation-preflight-lib.mjs';

const env=process.env,nowMs=Date.now(),SITE='https://sports-edge-eta.vercel.app';
const url=env.SPORTSEDGE_PROPS_SUPABASE_URL??'',key=env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY??'';
let host=null;try{host=new URL(url).hostname;}catch{/* reported below */}
const project=host&&/^[a-z0-9]{20}\.supabase\.co$/.test(host)?host.split('.')[0]:null;
const facts={schemaVersion:'props-activation-preflight-v1',at:new Date(nowMs).toISOString(),nowMs,project};
if(!key||project!==EXPECTED_PROJECT){
 facts.error=!key?'NOT_CONFIGURED':'UNEXPECTED_PROJECT';facts.verdict=verdict(facts);
 console.log(JSON.stringify(facts,null,1));process.exit(2);
}
const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),Accept:'application/json'};
/** GET only. Returns {ok,status,code,rows,count}. */
async function get(path,{count=false}={}){
 const res=await fetch(`https://${host}/rest/v1/${path}`,{method:'GET',headers:{...headers,...(count?{Prefer:'count=exact'}:{})},redirect:'error',signal:AbortSignal.timeout(20_000)});
 const text=await res.text();let body=null;try{body=JSON.parse(text);}catch{/* non-JSON */}
 const range=res.headers.get('content-range');
 return {ok:res.ok,status:res.status,code:!res.ok&&body&&typeof body.code==='string'?body.code:null,rows:res.ok&&Array.isArray(body)?body:[],
  count:range&&/\/(\d+)$/.test(range)?Number(range.split('/')[1]):null};
}
const iso=ms=>encodeURIComponent(new Date(ms).toISOString());
const inList=xs=>'in.('+xs.join(',')+')';

// 1. Capture schema (props_capture_v1.sql): table presence and row counts.
facts.captureTables={};facts.captureRows={};
for(const t of CAPTURE_TABLES){
 const r=await get(`${t}?select=*&limit=0`,{count:true});
 facts.captureTables[t]=r.ok?'PRESENT':missingRelation(r.code)?'MISSING':`ERROR_${r.status}_${r.code??''}`;
 if(r.ok)facts.captureRows[t]=r.count;
}
// 2. v3 accounting (props_budget_v3_actuals.sql): the count_provider_actuals column.
const v3=await get('props_budget_policy?select=count_provider_actuals&limit=1');
facts.v3Column=v3.ok?'PRESENT':missingColumn(v3.code)?'MISSING':`ERROR_${v3.status}_${v3.code??''}`;
const pol=await get('props_budget_policy?select=version,daily_credits,monthly_credits,provider_floor,active_from'+(v3.ok?',count_provider_actuals':'')+'&order=active_from.asc');
facts.policies=pol.rows;facts.activePolicy=activePolicy(pol.rows,nowMs);
// 3. Credits: reservations in 30 days, provider receipts, last provider count.
const res30=await get('props_credit_reservations?select=id,run_id,endpoint,credits,reserved_at&reserved_at=gt.'+iso(nowMs-30*86400_000)+'&order=id.asc&limit=10000');
const charged=new Map();
for(let i=0;i<res30.rows.length;i+=150){
 const ids=res30.rows.slice(i,i+150).map(r=>Number(r.id));
 for(const u of (await get('props_provider_usage?select=reservation_id,http_status,requests_last&reservation_id='+inList(ids)+'&limit=1000')).rows)
  if(u.requests_last!==null)charged.set(Number(u.reservation_id),Number(u.requests_last));
}
facts.credits=res30.ok?creditUse(res30.rows,charged,facts.activePolicy?.count_provider_actuals===true,nowMs):null;
if(facts.credits){
 const all=creditUse(res30.rows,charged,true,nowMs);
 facts.credits.ifProviderActualsCounted={used24h:all.used24h,used30d:all.used30d};
 facts.credits.byEndpoint30d=Object.fromEntries(['events','event_odds'].map(e=>[e,{reserved:res30.rows.filter(r=>r.endpoint===e).reduce((a,r)=>a+Number(r.credits),0),
  charged:res30.rows.filter(r=>r.endpoint===e&&charged.has(Number(r.id))).reduce((a,r)=>a+charged.get(Number(r.id)),0)}]));
}
const usage=await get('props_provider_usage?select=requests_remaining,recorded_at&requests_remaining=not.is.null&order=recorded_at.desc,id.desc&limit=1');
facts.providerRemaining=usage.rows[0]?Number(usage.rows[0].requests_remaining):null;facts.providerRemainingAt=usage.rows[0]?.recorded_at??null;
// 4. Runs: duplicates per slot, recent outcomes, settlement recency, control state.
const runs=await get('props_runs?select=id,kind,slot_key,status,outcome,started_at,finished_at&started_at=gt.'+iso(nowMs-14*86400_000)+'&order=id.desc&limit=2000');
facts.duplicateRuns=runs.ok?duplicates(runs.rows,r=>r.kind+'|'+r.slot_key):null;
facts.recentRuns=runs.rows.slice(0,16).map(r=>({id:r.id,kind:r.kind,slot:r.slot_key,status:r.status,outcome:r.outcome,startedAt:r.started_at}));
facts.tickRuns14d=runs.rows.filter(r=>String(r.slot_key).startsWith('collect-tick-')).length;
facts.lastCompletedSettleAt=runs.rows.find(r=>r.kind==='settle'&&r.status==='completed'&&r.outcome==='COMPLETED')?.finished_at??null;
facts.lastCompletedCollectAt=runs.rows.find(r=>r.kind==='collect'&&r.status==='completed'&&r.outcome==='COMPLETED')?.finished_at??null;
facts.control=(await get('props_control?select=state,reason,changed_at&id=eq.1')).rows[0]??null;
// 5. Entries: per-account daily caps held; picks never reused across entries (unique pick_id in legs).
const accounts=(await get('props_accounts?select=id,slug,selection_version,max_entries_per_day&order=id.asc')).rows;
const entries=await get('props_entries?select=id,account_id,created_at&created_at=gt.'+iso(nowMs-30*86400_000)+'&limit=5000');
facts.accounts=accounts;facts.entries30d=entries.rows.length;
facts.entryCapBreaches=entries.ok?entryCapBreaches(entries.rows,accounts):null;
// 6. What the live site says (the dashboard and chat read the same view): compare with the ledger numbers above.
try{
 const r=await fetch(SITE+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Is the Odds API budget exhausted?',context:null}),signal:AbortSignal.timeout(20_000)});
 const j=await r.json();facts.siteBudgetReply=j?.reply?.text?.slice(0,600)??null;
 const m=/(\d+) of (\d+) credits used in the last 24 hours and (\d+) of (\d+) in 30 days/.exec(facts.siteBudgetReply??'');
 facts.siteMatchesLedger=m&&facts.credits?Number(m[1])===facts.credits.used24h&&Number(m[3])===facts.credits.used30d:null;
}catch{facts.siteBudgetReply=null;facts.siteMatchesLedger=null;}
facts.verdict=verdict(facts);
const out=process.argv[2];
if(out)writeFileSync(out,JSON.stringify(facts,null,1));
console.log(JSON.stringify(facts,null,1));
