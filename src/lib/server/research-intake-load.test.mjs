import test from 'node:test';
import assert from 'node:assert/strict';
import {loadResearchIntake} from './research-intake-load.ts';
import {checksum} from '../research/provenance.ts';
const at='2026-11-19T12:00:00Z';
function source({bad=false,status='OK'}={}){
 const report={retrievedAt:at,sources:{openalex:{connected:status==='OK'?'VERIFIED_THIS_RUN':'FAILED'}}},manifest={items:[]};
 const receipt={schema:'research-intake-archive-v1',runId:'100-1',at,status,sourceCommit:'a'.repeat(40),manifestSha256:checksum(manifest),
 reportSha256:checksum(report),objectsSha256:'b'.repeat(64),reviewQueue:1,quarantined:2,objectsAdded:3,objectsReused:4};
 return async(url,opts)=>{assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');
  return new Response(url.endsWith('index.jsonl')?JSON.stringify(receipt):JSON.stringify(url.endsWith('manifest.json')?manifest:bad?{...report,retrievedAt:'bad'}:report));};
}
test('fresh receipts require hashes; partial and stale states stay visible; missing state is never fabricated',async()=>{
 const s=await loadResearchIntake('2026-11-19T13:00:00Z',source());assert.equal(s.receipt.status,'OK');assert.equal(s.stale,false);
 const p=await loadResearchIntake('2026-11-19T13:00:00Z',source({status:'PARTIAL'}));assert.equal(p.receipt.status,'PARTIAL');assert.equal(p.sources[0].state,'FAILED');
 assert.equal((await loadResearchIntake('2026-11-22T13:00:00Z',source())).stale,true);
 assert.equal((await loadResearchIntake('2026-11-19T13:00:00Z',source({bad:true}))).receipt,null);
 assert.equal((await loadResearchIntake('2026-11-19T13:00:00Z',async()=>new Response('',{status:404}))).receipt,null);
});
