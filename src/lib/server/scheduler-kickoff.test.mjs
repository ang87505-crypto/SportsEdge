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

test('research collect is skipped when today\'s slot already succeeded, and only Tue-Sat UTC', async()=>{
 const calls=[];
 const skip=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-10T04:20:00Z'),
  fetcher:fetcher(calls,{runs:[{created_at:'2026-11-10T02:40:00Z',status:'completed',conclusion:'success'}]})});
 assert.equal((await skip.json()).reason,'already_succeeded_since_slot');
 // Today's slot is queued or running: covered, do not stack a duplicate behind it.
 const busy=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-11T04:20:00Z'),
  fetcher:fetcher([],{runs:[{created_at:'2026-11-11T04:05:00Z',status:'in_progress',conclusion:null}]})});
 assert.equal((await busy.json()).reason,'already_running_since_slot');
 // Today's slot failed: the backup retries it once.
 const retry=[];
 const failed=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-11T04:20:00Z'),
  fetcher:fetcher(retry,{runs:[{created_at:'2026-11-11T02:41:00Z',status:'completed',conclusion:'failure'}]})});
 assert.equal(failed.status,202);
 assert.match(retry.at(-1).url,/research-collect\.yml\/dispatches$/);
 assert.doesNotMatch(retry[0].url,/status=success/);
 const run=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-10T04:20:00Z'),
  fetcher:fetcher(calls,{runs:[{created_at:'2026-11-08T02:40:00Z',status:'completed',conclusion:'success'}]})});
 assert.equal(run.status,202);
 const sunday=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-08T04:20:00Z'),fetcher:fetcher(calls)});
 assert.equal((await sunday.json()).reason,'outside_slot_hour');
});

test('a refused or failed dispatch is reported, never assumed', async()=>{
 const r=await handleSchedulerKickoff(req(),'ops-monitor',env,{now:at('2026-11-10T13:30:00Z'),fetcher:fetcher([],{status:422})});
 assert.deepEqual(await r.json(),{status:'dispatch_refused',slot:'ops-monitor',workflow:'ops-monitor.yml',httpStatus:422});
});

test('the one-session daily shadow backups only dispatch on their pinned dates',async()=>{
 for(const [name,iso,phase] of [['daily-shadow-plan','2026-11-10T12:20:00Z','plan'],
  ['daily-shadow-grade','2026-11-11T00:20:00Z','grade']]){
  const calls=[];
  const r=await handleSchedulerKickoff(req(),name,env,{now:at(iso),fetcher:fetcher(calls)});
  assert.equal(r.status,202);
  assert.deepEqual(calls[0].body,{ref:'main',inputs:{phase}});
  const later=iso.replace('2026','2027');
  assert.equal((await (await handleSchedulerKickoff(req(),name,env,{now:at(later),fetcher:fetcher(calls)})).json()).status,'skipped');
  assert.equal(calls.length,1);
 }
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

test('stock worker backups: weekday execute slots inside the trading window in both New York offsets, monitor after the close',async()=>{
 const stock=Object.entries(SCHEDULER_SLOTS).filter(([,s])=>s.workflow==='paper-auto-worker.yml');
 const kinds=stock.map(([,s])=>s.inputs.kind).sort();
 assert.deepEqual(kinds,['execute','execute','execute','monitor']);
 for(const [name,s] of stock){
  assert.deepEqual(Object.keys(s.inputs).sort(),['experiment','kind','trigger'],name);
  assert.equal(s.inputs.experiment,'stock-v2-weekly-1');assert.equal(s.inputs.trigger,'backup');
  assert.deepEqual(s.weekdaysUtc,[1,2,3,4,5],name);
  // Vercel Hobby fires somewhere inside the hour: [h:00, h:59].
  const first=s.hourUtc*60,last=first+59;
  for(const offset of [4,5]){ // EDT, EST
   const open=(9*60+30)+offset*60,close=16*60+offset*60;
   if(s.inputs.kind==='execute')assert.ok(first>=open&&last<close-20,`${name} outside the execute window at UTC-${offset}`);
   else assert.ok(first>=close,`${name} before the close at UTC-${offset}`);
  }
 }
 const calls=[];
 const r=await handleSchedulerKickoff(req(),'stock-execute-early',env,{now:at('2026-11-16T15:05:00Z'),fetcher:fetcher(calls)});
 assert.equal(r.status,202);
 assert.deepEqual(calls[0].body,{ref:'main',inputs:{kind:'execute',experiment:'stock-v2-weekly-1',trigger:'backup'}});
 assert.match(calls[0].url,/paper-auto-worker\.yml\/dispatches$/);
 const saturday=await handleSchedulerKickoff(req(),'stock-execute-early',env,{now:at('2026-11-14T15:05:00Z'),fetcher:fetcher(calls)});
 assert.equal((await saturday.json()).reason,'outside_slot_hour');
 assert.equal(calls.length,1);
});

test('regression 2026-11-11: a late run of yesterday\'s research slot does not suppress today\'s backup',async()=>{
 // GitHub started the 10 Nov 02:17 slot at 09:59; the 11 Nov 02:17 slot was dropped. The 04:00 backup must run.
 const calls=[];
 const r=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-11T04:20:00Z'),
  fetcher:fetcher(calls,{runs:[{created_at:'2026-11-10T09:59:25Z',status:'completed',conclusion:'success'}]})});
 assert.equal(r.status,202);
 // Today's own slot already succeeded (even if late, before the backup): skip.
 const skip=await handleSchedulerKickoff(req(),'research-collect',env,{now:at('2026-11-11T04:20:00Z'),
  fetcher:fetcher([],{runs:[{created_at:'2026-11-11T02:41:00Z',status:'completed',conclusion:'success'}]})});
 assert.equal((await skip.json()).reason,'already_succeeded_since_slot');
});

test('props capture ticks: inert while released off; when released they dispatch with their scheduled hour',async()=>{
 const {PROPS_COLLECTION_V2}=await import('../props/schedule.ts');
 const calls=[];
 const r=await handleSchedulerKickoff(req(),'props-tick-17',env,{now:at('2026-11-10T17:31:00Z'),fetcher:fetcher(calls)});
 if(PROPS_COLLECTION_V2.tickEnabled){
  assert.equal(r.status,202);
  assert.deepEqual(calls[0].body,{ref:'main',inputs:{trigger:'backup',scheduled_hour:'2026-11-10T17:00:00Z'}});
  assert.match(calls[0].url,/props-tick\.yml\/dispatches$/);
 }else{
  assert.deepEqual(await r.json(),{status:'skipped',reason:'props_tick_off',slot:'props-tick-17'});
  assert.equal(calls.length,0);
 }
 assert.equal((await (await handleSchedulerKickoff(req(),'props-tick-17',env,{now:at('2026-11-10T18:01:00Z'),fetcher:fetcher(calls)})).json()).reason,'outside_slot_hour');
});

test('tick backup hours cover a window of every evening tip-off from 22:00 to 04:30 UTC',async()=>{
 const {captureWindows}=await import('../props/capture-plan.ts');
 const hours=Object.values(SCHEDULER_SLOTS).filter(s=>s.tick).map(s=>s.hourUtc);
 for(let m=22*60;m<=28*60+30;m+=30){
  const tip=new Date(Date.UTC(2026,10,10,0,m)).toISOString();const w=captureWindows(tip);
  // A Vercel cron fires somewhere inside its hour: require a whole backup hour inside the LATE window or the EARLY one.
  const covered=[w.lateFrom,w.earlyFrom].some((from,i)=>{const to=Date.parse(i?w.earlyTo:w.lateTo);
   return hours.some(h=>{for(let d=-1;d<=1;d++){const s=Date.UTC(2026,10,10+d,h);if(s>=Date.parse(from)&&s+3600_000<=to)return true;}return false;});});
  assert.ok(covered,'no whole backup hour inside a window for tip '+tip);
 }
});
