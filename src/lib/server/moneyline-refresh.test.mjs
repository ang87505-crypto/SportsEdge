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

/** In-memory stand-in for research_refresh_slot_dispatch with the migration's semantics: claim and dispatch commit
 * together; a failed dispatch leaves the slot free. (The real atomicity is proven against PostgreSQL by
 * scripts/verify-research-refresh-sql.sh.) */
function slotDb({failFirst=false}={}){
 const slots=new Map();let dispatches=0,attempts=0,lock=Promise.resolve();
 const dispatchSlot=slot=>{const run=lock.then(async()=>{
   await new Promise(r=>setTimeout(r,2));
   if(slots.has(slot))return {status:'duplicate_slot',slot};
   attempts++;if(failFirst&&attempts===1)throw Error('DISPATCH_FAILED');
   dispatches++;slots.set(slot,String(100+dispatches));return {status:'dispatched',slot,dispatch:String(100+dispatches)};
  });lock=run.catch(()=>{});return run;};
 return {dispatchSlot,get dispatches(){return dispatches;},slots};
}
const deps=(over={})=>({now:()=>at,released:true,dispatchSlot:async()=>{throw Error('unexpected');},...over});

test('the release switch is off: no owner approval is recorded for a daily schedule',()=>{
 assert.equal(MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled,false);
 assert.equal(MONEYLINE_REFRESH_RELEASE.realMoneyEnabled,false);
});
test('with the shipped switch a correctly timed, authorised firing makes no network call',async()=>{
 const db=slotDb();
 const r=await handleMoneylineRefresh(req(),env,deps({released:undefined,dispatchSlot:db.dispatchSlot}));
 assert.equal((await body(r)).reason,'moneyline_schedule_off');assert.equal(db.dispatches,0);assert.equal(db.slots.size,0);
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
 const r=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:async s=>{seen.push(s);return {status:'dispatched',slot:s,dispatch:'42'};}}));
 const b=await body(r);
 assert.equal(r.status,202);assert.equal(b.status,'dispatched');assert.equal(b.dispatch,'42');assert.deepEqual(seen,[SLOT]);
 assert.equal(b.realMoneyEnabled,false);assert.equal(b.automaticBettingEnabled,false);
 const src=readFileSync(new URL('./moneyline-refresh.ts',import.meta.url),'utf8');
 assert.ok(!/research_reserve_credit|collectDualTracks|odds_snapshots|the-odds-api/.test(src.replace(/\/\*\*[\s\S]*?\*\//g,'')));
});
test('overlapping firings in one slot dispatch exactly once',async()=>{
 const db=slotDb();
 const rs=await Promise.all(Array.from({length:12},()=>handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot}))));
 const bs=await Promise.all(rs.map(body));
 assert.equal(db.dispatches,1);
 assert.equal(bs.filter(b=>b.status==='dispatched').length,1);
 assert.equal(bs.filter(b=>b.reason==='duplicate_slot').length,11);
});
test('replay after a failed dispatch retries once; replay after a committed dispatch never does',async()=>{
 const db=slotDb({failFirst:true});
 const first=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot}));
 assert.equal(first.status,503);assert.equal((await body(first)).automaticRetry,false);assert.equal(db.slots.size,0);
 const second=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot}));
 assert.equal((await body(second)).status,'dispatched');
 for(let i=0;i<3;i++)assert.equal((await body(await handleMoneylineRefresh(req(),env,deps({dispatchSlot:db.dispatchSlot})))).reason,'duplicate_slot');
 assert.equal(db.dispatches,1);
});
test('unexpected or mismatched database replies are unverified, never treated as dispatched',async()=>{
 for(const reply of [null,[],{},{status:'dispatched',slot:'moneyline-h2h-2026-11-26',dispatch:'1'},{status:'dispatched',slot:SLOT},
  {status:'queued',slot:SLOT,dispatch:'1'}]){
  const r=await handleMoneylineRefresh(req(),env,deps({dispatchSlot:async()=>reply}));
  assert.equal(r.status,503,JSON.stringify(reply));assert.equal((await body(r)).status,'dispatch_unverified');
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
test('the migration and the handler agree on the slot format, and the migration only wraps research_dispatch(false)',()=>{
 const sql=readFileSync(new URL('../../../database/migrations/20261126_research_refresh_slots_v1.sql',import.meta.url),'utf8');
 assert.ok(sql.includes("'^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$'"));assert.match(SLOT,/^moneyline-h2h-[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
 assert.ok(sql.includes('public.research_dispatch(false)'));assert.ok(!/research_dispatch\(true\)/.test(sql));
 const code=sql.replace(/--.*$/gm,'');
 assert.ok(!/research_reserve_credit|research_claim|research_finish|alter function|alter table public\.research_runs|drop /i.test(code),'no change to existing objects');
 assert.ok(/revoke all on function public\.research_refresh_slot_dispatch\(text\) from public, anon, authenticated/.test(sql));
});
