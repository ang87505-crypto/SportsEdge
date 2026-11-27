import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMoneylineHealth} from './moneyline-health.ts';
import {moneylineReceiptFixture as receipt} from '../moneyline-health-fixture.mjs';
const NOW='2026-11-27T13:00:00.000Z';
const env={VERCEL_ENV:'production',SUPABASE_URL:'https://fzyjazhvkstvwwzjhlrr.supabase.co',SUPABASE_SECRET_KEY:'synthetic-secret',ODDS_API_KEY:'synthetic-odds-key'};
function reader(x=receipt()){
 const calls=[];const fetcher=async(url,init)=>{calls.push({url:String(url),init});return Response.json(String(url).includes('/research_refresh_slots?')?x.slots:x.runs);};
 return {calls,fetcher};
}
test('an OFF policy performs no metadata, provider or account request',async()=>{
 const r=reader();assert.equal((await loadMoneylineHealth(NOW,env,{fetcher:r.fetcher,enabled:false})).state,'OFF');assert.equal(r.calls.length,0);
});
test('future first slots are plans, but missing configuration is still visible',async()=>{
 const r=reader();const now='2026-11-27T10:00:00Z';
 assert.equal((await loadMoneylineHealth(now,env,{fetcher:r.fetcher,enabled:true})).state,'PENDING');assert.equal(r.calls.length,0);
 assert.equal((await loadMoneylineHealth(now,{}, {fetcher:r.fetcher,enabled:true})).state,'UNAVAILABLE');
});
test('only two fixed-project GETs are used and no key or raw summary enters the output',async()=>{
 const r=reader(),h=await loadMoneylineHealth(NOW,env,{enabled:true,fetcher:r.fetcher});assert.equal(h.state,'OK');assert.equal(r.calls.length,2);
 assert.ok(r.calls.every(c=>c.url.startsWith(env.SUPABASE_URL+'/rest/v1/')&&c.init.method==='GET'&&c.init.redirect==='error'&&!c.init.body));
 assert.ok(r.calls.every(c=>!c.url.includes('rpc/')&&!c.url.includes('capability_hash')));
 const out=JSON.stringify(h);assert.ok(!out.includes('synthetic-secret'));assert.ok(!out.includes('NEVER_PUBLIC'));
});
test('wrong projects, fixture deployments and read-only mode fail before reading',async()=>{
 for(const e of [{...env,SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co'},{...env,VERCEL_ENV:'preview'},
  {...env,SPORTSEDGE_PREVIEW_FIXTURES:'1'},{...env,SUPABASE_READONLY_KEY:'readonly'},{...env,ODDS_API_KEY:undefined}]){
  const r=reader();assert.equal((await loadMoneylineHealth(NOW,e,{enabled:true,fetcher:r.fetcher})).state,'UNAVAILABLE');assert.equal(r.calls.length,0);
 }
});
test('missing migration, denied reads and malformed metadata cannot look healthy',async()=>{
 for(const fetcher of [async()=>Response.json({}, {status:404}),async()=>{throw Error('synthetic-secret');},async()=>Response.json({}),
  async()=>Response.json([{run_id:'42'}])])assert.equal((await loadMoneylineHealth(NOW,env,{enabled:true,fetcher})).state,'UNAVAILABLE');
});
