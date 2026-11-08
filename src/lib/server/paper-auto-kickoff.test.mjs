import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePaperKickoff} from './paper-auto-kickoff.ts';

const ENV={CRON_SECRET:'SYNTHETIC-CRON-SECRET-'+'A'.repeat(32),VERCEL_ENV:'production',
 SPORTSEDGE_GITHUB_DISPATCH_TOKEN:'github_pat_'+'A1'.repeat(20)};
const URL_='https://sportsedge.example/api/internal/paper-auto/kickoff';
async function run(at,{env=ENV,auth='Bearer '+ENV.CRON_SECRET,ready=true,reply=204,url=URL_,method='GET'}={}){
 const calls=[];let reads=0;
 const req=new Request(url,{method,headers:auth?{Authorization:auth}:{}});
 const res=await handlePaperKickoff(req,env,{now:()=>Date.parse(at),sportsReady:async()=>{reads++;return ready;},
  fetcher:async(url,init)=>{calls.push({url,init});if(reply==='lost')throw Error('reset');return new Response(null,{status:reply});}});
 const body=await res.json();
 assert.ok(!JSON.stringify(body).includes(ENV.CRON_SECRET));
 assert.ok(!JSON.stringify(body).includes(ENV.SPORTSEDGE_GITHUB_DISPATCH_TOKEN));
 return {status:res.status,body,calls,reads};
}
test('authentication, exact input and production checks happen before any dispatch or ledger read',async()=>{
 for(const options of [{auth:null},{auth:'Bearer wrong'},{env:{...ENV,CRON_SECRET:undefined}},
  {env:{...ENV,VERCEL_ENV:'preview'}},{url:URL_+'?kind=execute'},{method:'POST'}]){
  const r=await run('2026-11-09T09:05:00Z',options);
  assert.ok([400,401,403].includes(r.status));assert.equal(r.calls.length,0);assert.equal(r.reads,0);
 }
});
test('weekday kickoff uses only the reviewed weekly decision on main, early in both NY offsets',async()=>{
 for(const at of ['2026-11-09T09:05:00Z','2027-07-12T09:45:00Z']){
  const r=await run(at);assert.equal(r.status,202);assert.equal(r.calls.length,1);assert.equal(r.reads,0);
  assert.equal(r.calls[0].url,'https://api.github.com/repos/ang87505-crypto/SportsEdge/actions/workflows/paper-auto-decision-weekly.yml/dispatches');
  assert.equal(r.calls[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(r.calls[0].init.body),{ref:'main',inputs:{experiment:'stock-v2-weekly-1',session:at.slice(0,10),initial:'false'}});
 }
 for(const at of ['2026-11-09T12:45:00Z','2026-11-09T19:00:00Z','2026-11-14T09:00:00Z']){
  const r=await run(at);assert.equal(r.calls.length,0);assert.equal(r.body.status,'skipped');
 }
});
test('sports validation is confined to Nov 8 and a running real-collection ledger; it only settles',async()=>{
 const r=await run('2026-11-08T09:10:00Z');assert.equal(r.status,202);assert.equal(r.reads,1);
 assert.equal(r.calls[0].url,'https://api.github.com/repos/ang87505-crypto/SportsEdge/actions/workflows/props-daily.yml/dispatches');
 assert.deepEqual(JSON.parse(r.calls[0].init.body),{ref:'main',inputs:{kind:'settle'}});
 const paused=await run('2026-11-08T09:10:00Z',{ready:false});assert.equal(paused.calls.length,0);
 assert.equal((await run('2026-11-15T09:10:00Z')).calls.length,0);
});
test('GitHub failures and lost replies are reported after exactly one attempt',async()=>{
 for(const reply of [403,429,500,'lost']){
  const r=await run('2026-11-09T09:05:00Z',{reply});assert.equal(r.status,503);assert.equal(r.calls.length,1);
 }
});
