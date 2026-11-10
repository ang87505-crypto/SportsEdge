import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleSchedulerKickoff,SCHEDULER_SLOTS} from './scheduler-kickoff.ts';

const SECRET='s'.repeat(40),TOKEN='github_pat_'+'A'.repeat(40);
const env={CRON_SECRET:SECRET,VERCEL_ENV:'production',SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN};
const req=(auth='Bearer '+SECRET,url='https://x.test/api/internal/scheduler/props-collect-early')=>new Request(url,{headers:{authorization:auth}});
function fetcher(calls,{status=204,runs=[]}={}){
 return async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):null});
  if(String(url).includes('/runs?'))return Response.json({workflow_runs:runs});
  return new Response(null,{status});};
}
const at=iso=>()=>Date.parse(iso);

test('dispatches the props collect slot with its scheduled cron, inside its hour only', async()=>{
 const calls=[];
 const r=await handleSchedulerKickoff(req(),'props-collect-early',env,{now:at('2026-11-10T20:17:00Z'),fetcher:fetcher(calls)});
 assert.equal(r.status,202);
 assert.deepEqual(calls[0].body,{ref:'main',inputs:{kind:'collect',cron:'10 19 * * *'}});
 assert.match(calls[0].url,/props-daily\.yml\/dispatches$/);
 const late=await handleSchedulerKickoff(req(),'props-collect-early',env,{now:at('2026-11-10T21:01:00Z'),fetcher:fetcher(calls)});
 assert.equal((await late.json()).reason,'outside_slot_hour');
 assert.equal(calls.length,1);
});

test('refuses without the cron secret, outside production, for unknown slots, query strings or a missing token', async()=>{
 const calls=[],deps={now:at('2026-11-10T20:17:00Z'),fetcher:fetcher(calls)};
 assert.equal((await handleSchedulerKickoff(req('Bearer wrong'),'props-collect-early',env,deps)).status,401);
 assert.equal((await handleSchedulerKickoff(req(),'props-collect-early',{...env,VERCEL_ENV:'preview'},deps)).status,403);
 assert.equal((await handleSchedulerKickoff(req(),'paper-auto-worker',env,deps)).status,404);
 assert.equal((await handleSchedulerKickoff(req(),'__proto__',env,deps)).status,404);
 assert.equal((await handleSchedulerKickoff(req('Bearer '+SECRET,'https://x.test/a?x=1'),'props-collect-early',env,deps)).status,400);
 assert.equal((await handleSchedulerKickoff(req(),'props-collect-early',{...env,SPORTSEDGE_GITHUB_DISPATCH_TOKEN:'nope'},deps)).status,503);
 assert.equal(calls.length,0);
});

test('research collect is skipped when it already succeeded recently, and only Tue-Sat UTC', async()=>{
 const calls=[];
 const skip=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-10T04:20:00Z'),
  fetcher:fetcher(calls,{runs:[{created_at:'2026-11-10T02:40:00Z'}]})});
 assert.equal((await skip.json()).reason,'already_succeeded_recently');
 const run=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-10T04:20:00Z'),
  fetcher:fetcher(calls,{runs:[{created_at:'2026-11-08T02:40:00Z'}]})});
 assert.equal(run.status,202);
 const sunday=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-08T04:20:00Z'),fetcher:fetcher(calls)});
 assert.equal((await sunday.json()).reason,'outside_slot_hour');
});

test('a refused or failed dispatch is reported, never assumed', async()=>{
 const r=await handleSchedulerKickoff(req(),'ops-monitor',env,{now:at('2026-11-10T13:30:00Z'),fetcher:fetcher([],{status:422})});
 assert.deepEqual(await r.json(),{status:'dispatch_refused',slot:'ops-monitor',workflow:'ops-monitor.yml',httpStatus:422});
});

test('every slot has a daily Vercel cron in its own hour, and props slots name a real release cron', async()=>{
 const {slotCronMatches}=await import('../props/schedule.ts');
 const crons=JSON.parse(readFileSync(new URL('../../../vercel.json',import.meta.url),'utf8')).crons;
 for(const [name,slot] of Object.entries(SCHEDULER_SLOTS)){
  const c=crons.find(x=>x.path==='/api/internal/scheduler/'+name);
  assert.ok(c,'missing cron for '+name);
  const [min,hour]=c.schedule.split(' ');
  assert.equal(min,'0');assert.equal(Number(hour),slot.hourUtc);
  if(slot.props)assert.ok(slotCronMatches(slot.inputs.kind,slot.inputs.cron));
 }
 for(const c of crons)assert.doesNotMatch(c.schedule.split(' ').slice(0,2).join(' '),/[*\/,-]/,'Hobby allows daily crons only');
});
