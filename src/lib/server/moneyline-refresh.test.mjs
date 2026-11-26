import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleMoneylineRefresh,insertedCount,MONEYLINE_REFRESH_RELEASE,MONEYLINE_REFRESH_SLOT} from './moneyline-refresh.ts';

const secret='s'.repeat(40);
const env={CRON_SECRET:secret,VERCEL_ENV:'production',ODDS_API_KEY:'k',SUPABASE_SECRET_KEY:'sb_secret_x',
 SUPABASE_URL:'https://fzyjazhvkstvwwzjhlrr.supabase.co'};
const at=Date.parse('2026-11-27T11:00:30Z');
const req=(o={})=>new Request('https://sports-edge-eta.vercel.app/api/internal/moneyline-refresh',
 {headers:{authorization:'Bearer '+secret},...o});
function setup(over={}){
 const calls=[];let reads=0;
 const deps={now:()=>at,released:true,
  latestH2h:async()=>{calls.push('read');reads++;
   return reads===1?{observedAt:'2026-10-30T07:04:57+00:00',ingestedAt:'2026-10-30T07:05:10+00:00'}
    :{observedAt:'2026-11-27T10:58:00+00:00',ingestedAt:'2026-11-27T11:00:40+00:00'};},
  reserve:async t=>{calls.push('reserve:'+t);return true;},
  collect:async()=>{calls.push('collect');return {status:'completed',tracks:{nba:{oddsInserted:120},soccer:{oddsInserted:300}}};},
  ...over};
 return {calls,deps};
}
const body=async r=>JSON.parse(await r.text());

test('the release switch is off: no owner approval is recorded for a daily schedule',()=>{
 assert.equal(MONEYLINE_REFRESH_RELEASE.scheduledRunsEnabled,false);
 assert.equal(MONEYLINE_REFRESH_RELEASE.realMoneyEnabled,false);
});
test('with the shipped switch a correctly timed, authorised firing makes no network call',async()=>{
 const {calls,deps}=setup({released:undefined});
 const r=await handleMoneylineRefresh(req(),env,deps);
 assert.equal(r.status,200);assert.equal((await body(r)).reason,'moneyline_schedule_off');assert.deepEqual(calls,[]);
});
test('auth, method, query, environment and slot hour are checked before anything else',async()=>{
 const cases=[
  [req({headers:{authorization:'Bearer wrong'}}),env,401],
  [req({headers:{}}),env,401],
  [req(),{...env,CRON_SECRET:'short'},401],
  [new Request('https://x/api/internal/moneyline-refresh?force=1',{headers:{authorization:'Bearer '+secret}}),env,400],
  [req({method:'POST'}),env,400],
  [req(),{...env,VERCEL_ENV:'preview'},403],
 ];
 for(const [r,e,status] of cases){const {calls,deps}=setup();assert.equal((await handleMoneylineRefresh(r,e,deps)).status,status);assert.deepEqual(calls,[]);}
 const {calls,deps}=setup({now:()=>Date.parse('2026-11-27T12:00:00Z')});
 const r=await handleMoneylineRefresh(req(),env,deps);
 assert.equal((await body(r)).reason,'outside_slot_hour');assert.deepEqual(calls,[]);
});
test('reuses the research-cycle production pin: wrong project, read-only key or fixtures fail closed',async()=>{
 for(const e of [{...env,SUPABASE_URL:'https://vfyzbliksooljxrlfadp.supabase.co'},{...env,SUPABASE_READONLY_KEY:'r'},
  {...env,SPORTSEDGE_PREVIEW_FIXTURES:'1'},{...env,ODDS_API_KEY:undefined}]){
  const {calls,deps}=setup();const r=await handleMoneylineRefresh(req(),e,deps);
  assert.equal(r.status,503);assert.equal((await body(r)).status,'not_configured');assert.deepEqual(calls,[]);
 }
});
test('a refresh within 20 h is skipped before reserving credits',async()=>{
 const {calls,deps}=setup({latestH2h:async()=>{calls.push('read');return {observedAt:'2026-11-26T20:00:00Z',ingestedAt:'2026-11-26T20:00:05Z'};}});
 const r=await handleMoneylineRefresh(req(),env,deps);
 assert.equal((await body(r)).reason,'already_refreshed');assert.deepEqual(calls,['read']);
});
test('reserves NBA then soccer through the existing caps, collects once and verifies the saved receipt',async()=>{
 const {calls,deps}=setup();
 const r=await handleMoneylineRefresh(req(),env,deps);const b=await body(r);
 assert.equal(r.status,200);assert.equal(b.status,'refreshed');
 assert.deepEqual(calls,['read','reserve:nba','reserve:soccer','collect','read']);
 assert.equal(b.receipt.savedThisRun,true);assert.equal(b.receipt.collectorInserted,420);
 assert.equal(b.receipt.before.ingestedAt,'2026-10-30T07:05:10+00:00');
 assert.equal(b.receipt.after.observedAt,'2026-11-27T10:58:00+00:00');
 assert.equal(b.realMoneyEnabled,false);assert.equal(b.automaticBettingEnabled,false);
});
test('quota refusal on either track stops before the provider is called, with no retry',async()=>{
 for(const blocked of ['nba','soccer']){
  const {calls,deps}=setup({reserve:async t=>{calls.push('reserve:'+t);return t!==blocked;}});
  const r=await handleMoneylineRefresh(req(),env,deps);const b=await body(r);
  assert.equal(r.status,429);assert.equal(b.status,'quota_blocked');assert.equal(b.automaticRetry,false);
  assert.equal(b.creditsReserved,blocked==='soccer');assert.ok(!calls.includes('collect'));
 }
});
test('a collector claim that the database does not show is reported as unverified, not refreshed',async()=>{
 const {deps}=setup({latestH2h:async()=>({observedAt:'2026-10-30T07:04:57Z',ingestedAt:'2026-10-30T07:05:10Z'})});
 const r=await handleMoneylineRefresh(req(),env,deps);
 assert.equal(r.status,503);assert.equal((await body(r)).status,'refresh_unverified');
});
test('zero new quotes (unchanged prices or no fixtures) is reported as such',async()=>{
 const {deps}=setup({latestH2h:async()=>({observedAt:null,ingestedAt:null}),
  collect:async()=>({tracks:{nba:{oddsInserted:0},soccer:{oddsInserted:0}}})});
 const r=await handleMoneylineRefresh(req(),env,deps);
 assert.equal(r.status,200);assert.equal((await body(r)).status,'no_new_quotes');
});
test('thrown errors never leak messages (provider URLs carry the key)',async()=>{
 const {deps}=setup({collect:async()=>{throw Error('https://api.the-odds-api.com/v4/?apiKey=SECRET');}});
 const r=await handleMoneylineRefresh(req(),env,deps);const text=await r.text();
 assert.equal(r.status,503);assert.ok(!text.includes('SECRET'));assert.equal(JSON.parse(text).creditsReserved,true);
});
test('insertedCount accepts only the collector report shape',()=>{
 assert.equal(insertedCount({tracks:{nba:{oddsInserted:2},soccer:{oddsInserted:3}}}),5);
 for(const v of [null,{},{tracks:{nba:{}}},{tracks:{nba:{oddsInserted:'2'}}}])assert.equal(insertedCount(v),null);
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
