import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleMoneylineRefresh,slotKey,MONEYLINE_REFRESH_RELEASE,MONEYLINE_REFRESH_SLOT} from './moneyline-refresh.ts';

const secret='s'.repeat(40);
const env={CRON_SECRET:secret,VERCEL_ENV:'production',ODDS_API_KEY:'k',SUPABASE_SECRET_KEY:'sb_secret_x',
 SUPABASE_URL:'https://fzyjazhvkstvwwzjhlrr.supabase.co'};
const at=Date.parse('2026-11-27T11:00:30Z');
const SLOT='moneyline-h2h-2026-11-27';
const req=(o={})=>new Request('https://sports-edge-eta.vercel.app/api/internal/moneyline-refresh',
 {headers:{authorization:'Bearer '+secret},...o});
const body=async r=>JSON.parse(await r.text());

/** In-memory stand-in for research_refresh_slot_dispatch over a production-shaped research_dispatch (BIGINT run id;
 * NULL during a 25-minute cooldown). Calls are serialised like the per-slot advisory lock; a slot is recorded only
 * with a positive run id. The real behaviour is proven against PostgreSQL by scripts/verify-research-refresh-sql.sh. */
function slotDb({failFirst=false,cooldownUntil=0,clock=()=>at}={}){
 const slots=new Map();let runs=0,attempts=0,lock=Promise.resolve();const db={cooldownUntil};
 const dispatchSlot=slot=>{const run=lock.then(async()=>{
   await new Promise(r=>setTimeout(r,2));
   if(slots.has(slot))return {status:'duplicate_slot',slot,run_id:slots.get(slot)};
   attempts++;if(failFirst&&attempts===1)throw Error('DISPATCH_FAILED');
   if(clock()<db.cooldownUntil)return {status:'not_dispatched',slot,reason:'dispatcher_returned_null'};
   const id=100+(++runs);db.cooldownUntil=clock()+25*60_000;slots.set(slot,id);return {status:'dispatched',slot,run_id:id};
  });lock=run.catch(()=>{});return run;};
 return Object.defineProperty(Object.assign(db,{dispatchSlot,slots}),'runs',{get:()=>runs});
}
const deps=(over={})=>({now:()=>at,released:true,dispatchSlot:async()=>{throw Error('unexpected');},...over});

test('the approved data schedule is on while real money remains off',()=>{
 assert.equal(MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled,true);
 assert.equal(MONEYLINE_REFRESH_RELEASE.realMoneyEnabled,false);
});
test('an explicit OFF override still makes no network call',async()=>{
 const db=slotDb();
 const r=await handleMoneylineRefresh(req(),env,deps({released:false,dispatchSlot:db.dispatchSlot}));
 assert.equal((await body(r)).reason,'moneyline_schedule_off');assert.equal(db.runs,0);assert.equal(db.slots.size,0);
});
test('auth, method, query, environment and slot hour are checked before anything else',async()=>{
 const cases=[[req({headers:{authorization:'Bearer wrong'}}),env,401],[req({headers:{}}),env,401],[req(),{...env,CRON_SECRET:'short'},401],
  [new Request('https://x/api/internal/moneyline-refresh?force=1',{headers:{authorization:'Bearer '+secret}}),env,400],
  [req({method:'POST'}),env,400],[req(),{...env,VERCEL_ENV:'preview'},403]];
 for(const [r,e,status] of cases){const db=slotDb();assert.equal((await handleMoneylineRefresh(r,e,deps({dispatchSlot:db.dispatchSlot}))).status,status);assert.equal(db.slots.size,0);}
 const db=slotDb();
 const r=await handleMoneylineRefresh(req(),env,deps({now:()=>Date.parse('2026-11-27T12:00:00Z'),dispatchSlot:db.dispatchSlot}));
 assert.equal((await body(r)).reason,'outside_slot_hour');assert.equal(db.slots.size,0);
});
test('reuses the research-cycle production pin: wrong project, read-only key or fixtures fail closed',async()=>{
 for(const e of [{...env,SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co'},{...env,SUPABASE_READONLY_KEY:'r'},
  {...env,SPORTSEDGE_PREVIEW_FIXTURES:'1'},{...env,ODDS_API_KEY:undefined}]){
  const db=slotDb();const r=await handleMoneylineRefresh(req(),e,deps({dispatchSlot:db.dispatchSlot}));
  assert.equal(r.status,503);assert.equal((await body(r)).status,'not_configured');assert.equal(db.slots.size,0);
 }
});
test('the slot is the UTC date of the firing',()=>{
 assert.equal(slotKey(new Date(at)),SLOT);assert.equal(slotKey(new Date('2026-11-27T23:59:59Z')),SLOT);
});
test('the handler only dispatches the slot: it never reserves credits, calls the provider or writes odds itself',async()=>{
 const seen=[];
 const r=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:async s=>{seen.push(s);return {status:'dispatched',slot:s,run_id:42};}}));
 const b=await body(r);
 assert.equal(r.status,202);assert.equal(b.status,'dispatched');assert.equal(b.runId,42);assert.deepEqual(seen,[SLOT]);
 assert.equal(b.realMoneyEnabled,false);assert.equal(b.automaticBettingEnabled,false);
 const src=readFileSync(new URL('./moneyline-refresh.ts',import.meta.url),'utf8');
 assert.ok(!/research_reserve_credit|collectDualTracks|odds_snapshots|the-odds-api/.test(src.replace(/\/\*\*[\s\S]*?\*\//g,'')));
});
test('overlapping firings in one slot dispatch exactly once',async()=>{
 const db=slotDb();
 const rs=await Promise.all(Array.from({length:12},()=>handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot}))));
 const bs=await Promise.all(rs.map(body));
 assert.equal(db.runs,1);
 assert.equal(bs.filter(b=>b.status==='dispatched').length,1);
 assert.equal(bs.filter(b=>b.reason==='duplicate_slot').length,11);
 assert.ok(bs.every(b=>b.runId===undefined||b.runId===101));
});
test('NULL from research_dispatch (cooldown) is never success and leaves the slot open; the retry then dispatches once',async()=>{
 let t=at;const db=slotDb({cooldownUntil:at+10*60_000,clock:()=>t});
 const first=await handleMoneylineRefresh(req(),env,deps({now:()=>t,dispatchSlot:db.dispatchSlot}));const b1=await body(first);
 assert.equal(first.status,409);assert.equal(b1.status,'not_dispatched');assert.equal(b1.reason,'dispatcher_returned_null');
 assert.equal(b1.slotAvailable,true);assert.equal(b1.automaticRetry,false);assert.equal(b1.runId,undefined);
 assert.equal(db.slots.size,0);assert.equal(db.runs,0);
 // Concurrent firings during the cooldown: none dispatch, none consume the slot.
 const during=await Promise.all(Array.from({length:6},()=>handleMoneylineRefresh(req(),env,deps({now:()=>t,dispatchSlot:db.dispatchSlot}))));
 assert.deepEqual((await Promise.all(during.map(body))).map(b=>b.status),Array(6).fill('not_dispatched'));
 assert.equal(db.slots.size,0);
 t=at+11*60_000; // still 11:xx UTC, cooldown over
 const retry=await body(await handleMoneylineRefresh(req(),env,deps({now:()=>t,dispatchSlot:db.dispatchSlot})));
 assert.equal(retry.status,'dispatched');assert.equal(retry.runId,101);
 t=at+50*60_000; // after the new run's own cooldown too: the slot, not the cooldown, prevents a second run
 const replay=await body(await handleMoneylineRefresh(req(),env,deps({now:()=>t,dispatchSlot:db.dispatchSlot})));
 assert.equal(replay.reason,'duplicate_slot');assert.equal(replay.runId,101);assert.equal(db.runs,1);
});
test('replay after an exception retries once; replay after a recorded run never does',async()=>{
 const db=slotDb({failFirst:true});
 const first=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot}));
 assert.equal(first.status,503);assert.equal((await body(first)).automaticRetry,false);assert.equal(db.slots.size,0);
 const second=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot}));
 assert.equal((await body(second)).status,'dispatched');
 for(let i=0;i<3;i++)assert.equal((await body(await handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot})))).reason,'duplicate_slot');
 assert.equal(db.runs,1);
});
test('only a positive integer run id counts as dispatched; anything else is unverified, never success',async()=>{
 for(const reply of [null,[],{},{status:'dispatched',slot:'moneyline-h2h-2026-11-26',run_id:1},{status:'dispatched',slot:SLOT},
  {status:'dispatched',slot:SLOT,run_id:null},{status:'dispatched',slot:SLOT,run_id:0},{status:'dispatched',slot:SLOT,run_id:-3},
  {status:'dispatched',slot:SLOT,run_id:'42'},{status:'dispatched',slot:SLOT,run_id:1.5},{status:'dispatched',slot:SLOT,dispatch:''},
  {status:'duplicate_slot',slot:SLOT,run_id:null},{status:'not_dispatched',slot:SLOT,reason:'other'},{status:'queued',slot:SLOT,run_id:1}]){
  const r=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:async()=>reply}));const b=await body(r);
  assert.equal(r.status,503,JSON.stringify(reply));assert.equal(b.status,'dispatch_unverified');
 }
});
test('thrown errors never leak messages',async()=>{
 const r=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:async()=>{throw Error('https://x/?apikey=SECRET');}}));
 const text=await r.text();assert.equal(r.status,503);assert.ok(!text.includes('SECRET'));
});
test('vercel.json has exactly one cron for the route, inside the slot hour, clear of other Odds API jobs',()=>{
 const crons=JSON.parse(readFileSync(new URL('../../../vercel.json',import.meta.url),'utf8')).crons;
 const mine=crons.filter(c=>c.path===MONEYLINE_REFRESH_SLOT.path);
 assert.deepEqual(mine,[{path:MONEYLINE_REFRESH_SLOT.path,schedule:MONEYLINE_REFRESH_SLOT.cron}]);
 const hour=s=>Number(s.split(' ')[1]);
 assert.equal(hour(MONEYLINE_REFRESH_SLOT.cron),MONEYLINE_REFRESH_SLOT.hourUtc);
 const props=crons.filter(c=>/props-(collect|tick)/.test(c.path)).map(c=>hour(c.schedule));
 assert.ok(!props.includes(MONEYLINE_REFRESH_SLOT.hourUtc));
});
test('the migration enforces the verified contract and only wraps research_dispatch(false)',()=>{
 const sql=readFileSync(new URL('../../../database/migrations/20261126_research_refresh_slots_v1.sql',import.meta.url),'utf8');
 const code=sql.replace(/--.*$/gm,'');
 assert.ok(code.includes("'^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$'"));assert.match(SLOT,/^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
 assert.match(code,/pg_get_function_result\('public\.research_dispatch\(boolean\)'::regprocedure\) <> 'bigint'/);
 assert.match(code,/v_run bigint;/);assert.match(code,/v_run := public\.research_dispatch\(false\);/);
 assert.match(code,/if v_run is null or v_run <= 0 then/);assert.match(code,/run_id bigint not null check \(run_id > 0\)/);
 assert.ok(!/::text/.test(code),'no text conversion of the run id');
 assert.ok(code.indexOf('research_dispatch(false)')<code.indexOf('insert into public.research_refresh_slots'),'slot written only after dispatch');
 assert.ok(!/research_dispatch\(true\)|research_reserve_credit|research_claim|research_finish|alter function|grant execute on function public\.research_dispatch|drop /i.test(code),'no change to existing objects');
 assert.match(code,/revoke all on function public\.research_refresh_slot_dispatch\(text\) from public, anon, authenticated/);
 assert.match(code,/grant execute on function public\.research_refresh_slot_dispatch\(text\) to service_role/);
});
