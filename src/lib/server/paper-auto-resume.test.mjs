import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeAfterOwnerCheck} from './paper-auto-resume.ts';
import {PaperAutoStoreError} from './paper-auto-store.ts';

function world(){
 const state={gateVersion:2,gateMode:'STOPPED'};
 const calls=[];
 const deps={now:()=>Date.parse('2026-11-09T14:30:00Z'),store:{call:async(fn,p)=>{
  calls.push({fn,p});
  if(fn==='status')return {...state};
  if(fn==='resume'){
   if(p.expected_gate_version!==state.gateVersion)throw new PaperAutoStoreError('PAPER_AUTO_RESUME_STALE_VERSION',true);
   state.gateMode='ARMED';return {...state,state:'READY'};
  }
  throw Error('unexpected RPC');
 }}};
 return {state,calls,deps,stop:()=>{state.gateVersion++;state.gateMode='STOPPED';}};
}
const clean=async()=>({reason:'CLEAN',runId:'run-'+'a'.repeat(32)});

test('queued Start is invalidated by an owner Stop before the worker begins',async()=>{
 const w=world();w.stop();
 let checks=0;
 await assert.rejects(resumeAfterOwnerCheck(w.deps,'fwd-test','owner-test',2,async()=>{checks++;return clean();}),
  e=>e.code==='PAPER_AUTO_RESUME_STALE_VERSION');
 assert.equal(checks,0);assert.equal(w.state.gateMode,'STOPPED');
});

test('owner Stop during the account check wins over the delayed clean Start',async()=>{
 for(const expected of [2,undefined]){
  const w=world();
  await assert.rejects(resumeAfterOwnerCheck(w.deps,'fwd-test','owner-test',expected,async()=>{w.stop();return clean();}),
   e=>e.code==='PAPER_AUTO_RESUME_STALE_VERSION');
  assert.equal(w.state.gateMode,'STOPPED');
  assert.equal(w.calls.find(c=>c.fn==='resume').p.expected_gate_version,2);
 }
});

test('a clean unchanged Start arms with that exact receipt; blocked checks never resume',async()=>{
 const w=world();
 const ok=await resumeAfterOwnerCheck(w.deps,'fwd-test','owner-test',2,clean);
 assert.equal(ok.status,'RESUMED');assert.equal(w.state.gateMode,'ARMED');
 assert.equal(w.calls.find(c=>c.fn==='resume').p.reconcile_run_id,'run-'+'a'.repeat(32));
 const b=world();
 const no=await resumeAfterOwnerCheck(b.deps,'fwd-test','owner-test',2,async()=>({reason:'NOT_CLEAN',outcome:'BLOCKED',runId:null}));
 assert.equal(no.status,'RECONCILE_NOT_CLEAN');assert.equal(b.calls.length,1);assert.equal(b.state.gateMode,'STOPPED');
});
