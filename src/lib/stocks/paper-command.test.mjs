import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedNbaRun,validCommandId} from '../paper-command.ts';

const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
function store(){
 const entries=new Map();let unresolved=null;
 const events=[];
 return {entries,events,service:{
  async claim(id){
   events.push('claim:'+id);
   const old=entries.get(id);
   if(old)return old.status==='completed'?{state:'replayed',result:old.result}:{state:'blocked'};
   if(unresolved)return {state:'blocked'};
   unresolved=id;
   entries.set(id,{status:'running',result:null});
   return {state:'claimed'};
  },
  async finish(id,status,result){
   events.push('finish:'+status);
   const row=entries.get(id);
   assert.equal(row?.status,'running');
   row.status=status;row.result=result;
   if(status==='completed')unresolved=null;
  }
 }};
}
test('request IDs are bounded UUID strings',()=>{
 assert.equal(validCommandId(A),true);
 for(const value of [undefined,null,'hello','x'.repeat(300),'00000000-0000-4000-8000-invalid',{id:A}])assert.equal(validCommandId(value),false);
});
test('same ID is replayed without executing another NBA batch',async()=>{
 const x=store();let executions=0;
 const runner=async()=>{executions++;return {positionIds:[12],failedGames:[]};};
 const one=await guardedNbaRun(A,x.service,runner);
 const two=await guardedNbaRun(A,x.service,runner);
 assert.deepEqual(one,{state:'completed',result:{positionIds:[12],failedGames:[]}});
 assert.deepEqual(two,{state:'replayed',result:one.result});
 assert.equal(executions,1);
});
test('two concurrent IDs cannot overlap while first claim is active',async()=>{
 const x=store();let unlock;const gate=new Promise(resolve=>{unlock=resolve;});
 let executions=0;
 const first=guardedNbaRun(A,x.service,async()=>{executions++;await gate;return {failedGames:[]};});
 await new Promise(resolve=>setImmediate(resolve));
 const next=await guardedNbaRun(B,x.service,async()=>{executions++;return {};});
 assert.deepEqual(next,{state:'blocked'});
 unlock();
 assert.equal((await first).state,'completed');
 assert.equal(executions,1);
});
test('uncertain database write blocks new commands permanently until reconciled',async()=>{
 const x=store();
 assert.deepEqual(await guardedNbaRun(A,x.service,async()=>({failedGames:[44]})),{state:'uncertain'});
 assert.equal(x.entries.get(A).status,'uncertain');
 let secondCalled=false;
 assert.deepEqual(await guardedNbaRun(B,x.service,async()=>{secondCalled=true;}),{state:'blocked'});
 assert.equal(secondCalled,false);
});
test('runner exception is never retried and leaves uncertain receipt',async()=>{
 const x=store();let tries=0;
 const one=await guardedNbaRun(A,x.service,async()=>{tries++;throw Error('some secret database error');});
 assert.deepEqual(one,{state:'uncertain'});
 assert.equal(x.entries.get(A).status,'uncertain');
 assert.equal(tries,1);
 assert.deepEqual(await guardedNbaRun(A,x.service,async()=>{tries++;return null;}),{state:'blocked'});
 assert.equal(tries,1);
});
test('missing durable receipt storage never reaches runner',async()=>{
 let attempts=0;
 const fail={claim:async()=>{throw Error('missing table');},finish:async()=>{throw Error('should not happen');}};
 assert.deepEqual(await guardedNbaRun(A,fail,async()=>{attempts++;return {};}),{state:'unavailable'});
 assert.equal(attempts,0);
});
test('lost receipt acknowledgment fails closed even if the runner finished',async()=>{
 const x=store();let runs=0;
 const bad={...x.service,finish:async()=>{throw Error('database response lost');}};
 assert.deepEqual(await guardedNbaRun(A,bad,async()=>{runs++;return {failedGames:[]};}),{state:'uncertain'});
 assert.equal(x.entries.get(A).status,'running');
 assert.deepEqual(await guardedNbaRun(B,x.service,async()=>{runs++;}),{state:'blocked'});
 assert.equal(runs,1);
});
