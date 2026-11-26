import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadResearchEngine,resetResearchEngineCache,ENGINE_PUBLIC_ROOT} from './research-engine-load.ts';
import {fingerprint} from '../lab/engine/experiments.ts';
import {ENGINE_ARCHIVE_VERSION} from '../lab/engine/archive.ts';
import {sportsScorecard} from '../lab/engine/scorecard.ts';

const seed=JSON.parse(readFileSync(new URL('../../../research/engine/registry.json',import.meta.url),'utf8'));
const at='2026-11-19T17:00:00Z';
function source({status='OK',tamper=false,receiptAt=at,scorecard=undefined}={}){
 const report={at:receiptAt,status,failure:status==='FAILED'?'synthetic':null,...(scorecard===undefined?{}:{domains:{sports:{scorecard}}})};
 const receipt={schema:ENGINE_ARCHIVE_VERSION,runId:'100-1',at:receiptAt,status,sourceCommit:'a'.repeat(40),registrySha256:fingerprint(seed),reportSha256:fingerprint(report),summary:'SYNTHETIC loader test'};
 const responses={'learning-engine/index.jsonl':JSON.stringify(receipt)+'\n','learning-engine/runs/100-1/registry.json':JSON.stringify(tamper?{...seed,experiments:[]}:seed),'learning-engine/runs/100-1/report.json':JSON.stringify(report)};
 let calls=0;
 return {fetcher:async(url,options)=>{calls++;assert.ok(url.startsWith(ENGINE_PUBLIC_ROOT));assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  return new Response(responses[url.slice(ENGINE_PUBLIC_ROOT.length)]??'',{status:responses[url.slice(ENGINE_PUBLIC_ROOT.length)]?200:404});},calls:()=>calls};
}

test('fresh hash-verified evaluations are loaded and cached; failures remain visible',async()=>{
 resetResearchEngineCache();const s=source();const v=await loadResearchEngine('2026-11-19T17:05:00Z',s.fetcher);
 assert.equal(v.mode,'live');assert.equal(v.stale,false);assert.equal(v.status,'OK');assert.equal(v.jobs[0].run,'100-1');
 assert.equal(v.scorecard,null,'older published evaluations remain valid without a new scorecard');
 await loadResearchEngine('2026-11-19T17:05:30Z',s.fetcher);assert.equal(s.calls(),3);
 resetResearchEngineCache();const failed=await loadResearchEngine('2026-11-19T17:05:00Z',source({status:'FAILED'}).fetcher);
 assert.equal(failed.mode,'live');assert.equal(failed.status,'FAILED');assert.match(failed.detail,/failed/);
});

test('optional scorecards come only from accepted successful reports; malformed diagnostics cannot replace evidence',async()=>{
 const scorecard=sportsScorecard([]);
 resetResearchEngineCache();const v=await loadResearchEngine('2026-11-19T17:05:00Z',source({scorecard}).fetcher);
 assert.deepEqual(v.scorecard,scorecard);
 resetResearchEngineCache();const failed=await loadResearchEngine('2026-11-19T17:05:00Z',source({status:'FAILED',scorecard}).fetcher);
 assert.equal(failed.scorecard,null);
 resetResearchEngineCache();const bad=await loadResearchEngine('2026-11-19T17:05:00Z',source({scorecard:{...scorecard,groups:[]}}).fetcher);
 assert.equal(bad.mode,'live');assert.equal(bad.scorecard,null);
});

test('stale, future, tampered and missing evidence never becomes a current success',async()=>{
 resetResearchEngineCache();const stale=await loadResearchEngine('2026-11-22T17:05:00Z',source().fetcher);
 assert.equal(stale.mode,'live');assert.equal(stale.stale,true);
 for(const fetcher of [source({tamper:true}).fetcher,source({receiptAt:'2027-01-01T00:00:00Z'}).fetcher,async()=>new Response('',{status:404})]){
  resetResearchEngineCache();const v=await loadResearchEngine('2026-11-19T17:05:00Z',fetcher);
  assert.equal(v.mode,'saved');assert.equal(v.stale,true);assert.equal(v.status,'UNAVAILABLE');assert.match(v.detail,/dated saved research/);
 }
});

test('engine attention: evidence gaps and sports alarms reach the page only as short, well-formed strings',async()=>{
 const {readEngineAttention}=await import('./research-engine-load.ts');
 const r=readEngineAttention({evidence:{inputs:{sports:'CONNECTED',stocks:'NOT_SUPPLIED',weather:'CONNECTED','<b>':'x'},
  gaps:[{code:'STOCK_EVIDENCE_NOT_SUPPLIED',detail:'5 active stock experiments'},{code:'<script>',detail:'x'}]},
  domains:{sports:{alarms:{status:'ALARM',alarms:[{code:'MISSING_OUTCOMES',detail:'20 of 480 locked lines'}]}}}});
 assert.deepEqual(r.gaps.map(g=>g.code),['STOCK_EVIDENCE_NOT_SUPPLIED']);
 assert.deepEqual(r.inputs,{sports:'CONNECTED',stocks:'NOT_SUPPLIED',weather:'CONNECTED'});
 assert.deepEqual(r.alarms,{status:'ALARM',codes:['MISSING_OUTCOMES'],details:['20 of 480 locked lines']});
 assert.equal(readEngineAttention({domains:{sports:{alarms:{status:'WEIRD'}}}}).alarms,null);
 assert.equal(readEngineAttention(null),null);
});
