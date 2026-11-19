// Re-enabling only what GitHub disabled for inactivity; synthetic fetcher, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchWorkflow} from './github-dispatch.ts';

const TOKEN='github_pat_'+'A1'.repeat(20);
function gh(script){
 const calls=[];
 const fetcher=async(url,init)=>{calls.push({url:String(url),method:init.method});
  const step=script.shift();if(!step)throw new Error('unexpected call '+init.method+' '+url);
  if(step==='lost')throw new Error('reset');
  return step.json?Response.json(step.json,{status:step.status??200}):new Response(null,{status:step.status});};
 return {calls,fetcher};
}
const W='research-collect.yml';

test('normal dispatch: one POST, nothing else',async()=>{
 const g=gh([{status:204}]);
 assert.deepEqual(await dispatchWorkflow(g.fetcher,TOKEN,W,{},'test'),{status:'dispatched'});
 assert.deepEqual(g.calls.map(c=>c.method),['POST']);
});

test('disabled for inactivity: read state, re-enable, dispatch once more',async()=>{
 const g=gh([{status:422},{json:{state:'disabled_inactivity'}},{status:204},{status:204}]);
 assert.deepEqual(await dispatchWorkflow(g.fetcher,TOKEN,W,{kind:'x'},'test'),{status:'dispatched',reenabled:true,workflowState:'disabled_inactivity'});
 assert.deepEqual(g.calls.map(c=>c.method+' '+c.url.split('/workflows/')[1]),
  ['POST research-collect.yml/dispatches','GET research-collect.yml','PUT research-collect.yml/enable','POST research-collect.yml/dispatches']);
});

test('disabled by the owner is never re-enabled; nor is an active workflow that refused',async()=>{
 for(const state of ['disabled_manually','active','disabled_fork']){
  const g=gh([{status:422},{json:{state}}]);
  const r=await dispatchWorkflow(g.fetcher,TOKEN,W,{},'test');
  assert.equal(r.status,'dispatch_refused');assert.equal(r.workflowState,state);assert.equal(r.reenabled,undefined);
  assert.deepEqual(g.calls.map(c=>c.method),['POST','GET']);
 }
});

test('auth failures, rate limits, server errors and lost replies: no state read, no retry',async()=>{
 for(const [step,status] of [[{status:401},'dispatch_refused'],[{status:429},'dispatch_outcome_unknown'],[{status:502},'dispatch_outcome_unknown'],['lost','dispatch_outcome_unknown']]){
  const g=gh([step]);
  assert.equal((await dispatchWorkflow(g.fetcher,TOKEN,W,{},'test')).status,status);
  assert.equal(g.calls.length,1);
 }
});

test('enable refused or state unreadable: the original refusal stands, no second dispatch',async()=>{
 const a=gh([{status:422},{json:{state:'disabled_inactivity'}},{status:403}]);
 const r=await dispatchWorkflow(a.fetcher,TOKEN,W,{},'test');
 assert.equal(r.status,'dispatch_refused');assert.equal(r.httpStatus,422);
 assert.equal(a.calls.filter(c=>c.method==='POST').length,1);
 const b=gh([{status:422},'lost']);
 assert.equal((await dispatchWorkflow(b.fetcher,TOKEN,W,{},'test')).status,'dispatch_refused');
 assert.equal(b.calls.filter(c=>c.method==='POST').length,1);
});

test('only fixed workflow file names are accepted',async()=>{
 const g=gh([]);
 assert.equal((await dispatchWorkflow(g.fetcher,TOKEN,'../../evil',{},'test')).status,'dispatch_refused');
 assert.equal(g.calls.length,0);
});
