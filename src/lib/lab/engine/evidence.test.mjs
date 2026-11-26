// Evidence coverage (engine-evidence-v1): missing inputs and evidence-less experiments are reported, never silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evidenceCoverage,EVIDENCE_POLICY} from './evidence.ts';

const ROOT=new URL('../../../../',import.meta.url);
const NOW='2026-11-28T00:00:00Z';
const exp=(id,domain,status,at,forward)=>({id,domain,status,forward,history:[{at,from:null,to:status,reason:'seed',inputFingerprint:null}]});
const reg=experiments=>({schema:'sportsedge-learning-registry-v1',experiments});

test('absent stock and sports inputs are named as gaps only when active experiments need them',()=>{
 const r=evidenceCoverage(reg([exp('s1','sports','RUNNING','2026-11-27T00:00:00Z',{kind:'ledger-models'}),exp('k1','stocks','RUNNING','2026-11-27T00:00:00Z')]),
  {sportsLedger:false,stockWeeks:false},NOW);
 assert.deepEqual(r.gaps.map(g=>g.code),['SPORTS_LEDGER_NOT_SUPPLIED','STOCK_EVIDENCE_NOT_SUPPLIED']);
 assert.deepEqual(r.inputs,{sports:'NOT_SUPPLIED',stocks:'NOT_SUPPLIED',weather:'NOT_SUPPLIED'});
 const wx=evidenceCoverage(reg([exp('w1','weather','RUNNING','2026-11-27T00:00:00Z')]),{sportsLedger:true,stockWeeks:true},NOW);
 assert.deepEqual(wx.gaps.map(g=>g.code),['WEATHER_EVIDENCE_NOT_SUPPLIED']);
 assert.deepEqual(evidenceCoverage(reg([exp('w1','weather','RUNNING','2026-11-27T00:00:00Z')]),{sportsLedger:true,stockWeeks:true,weatherForward:true},NOW).gaps,[]);
 const ok=evidenceCoverage(reg([exp('s1','sports','RUNNING','2026-11-27T00:00:00Z',{kind:'ledger-models'})]),{sportsLedger:true,stockWeeks:false},NOW);
 assert.deepEqual(ok.gaps,[],'no active stock experiment: no stock gap');
 const rejectedOnly=evidenceCoverage(reg([exp('k1','stocks','REJECTED','2026-01-01T00:00:00Z')]),{sportsLedger:true,stockWeeks:false},NOW);
 assert.deepEqual(rejectedOnly.gaps,[]);assert.deepEqual(rejectedOnly.outcomes.rejected,['k1']);
});

test('active experiments without an automatic source are listed; quiet ones beyond the policy are a gap',()=>{
 const r=evidenceCoverage(reg([exp('auto','sports','INSUFFICIENT_DATA','2026-09-01T00:00:00Z',{kind:'ledger-models'}),
  exp('fresh','sports','RUNNING','2026-11-20T00:00:00Z'),exp('quiet','sports','RUNNING','2026-10-01T00:00:00Z'),
  exp('done','sports','FAILED','2026-10-01T00:00:00Z'),exp('wait','stocks','READY_FOR_REVIEW','2026-10-01T00:00:00Z')]),{sportsLedger:true,stockWeeks:true},NOW);
 assert.equal(r.experiments.active,3);assert.equal(r.experiments.automatic,1);
 assert.deepEqual(r.experiments.ownerSuppliedOnly.map(e=>[e.id,e.daysSinceChange]),[['fresh',8],['quiet',58]]);
 assert.deepEqual(r.gaps.map(g=>g.code),['NO_AUTOMATIC_EVIDENCE']);assert.match(r.gaps[0].detail,/quiet/);
 assert.doesNotMatch(r.gaps[0].detail,/fresh/);
 assert.deepEqual(r.outcomes,{failed:['done'],rejected:[],readyForReview:['wait']});
 assert.throws(()=>evidenceCoverage(reg([]),{sportsLedger:true,stockWeeks:true},'nope'),/EVIDENCE_INVALID_CLOCK/);
 assert.equal(EVIDENCE_POLICY.quietDays,30);
});

test('experiments fed by an automatic producer on this run are not listed as lacking one',()=>{
 const r=reg([exp('lab','stocks','RUNNING','2026-11-27T00:00:00Z'),exp('none','sports','RUNNING','2026-09-01T00:00:00Z')]);
 const without=evidenceCoverage(r,{sportsLedger:true,stockWeeks:true},NOW).experiments.ownerSuppliedOnly.map(e=>e.id);
 const withFeed=evidenceCoverage(r,{sportsLedger:true,stockWeeks:true,fedByProducer:['lab']},NOW);
 assert.deepEqual(without,['lab','none']);assert.deepEqual(withFeed.experiments.ownerSuppliedOnly.map(e=>e.id),['none']);
 assert.equal(withFeed.experiments.automatic,1);
});

test('end to end: the engine report states its evidence coverage and moves nothing because of it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'evidence-'));
 writeFileSync(join(dir,'rows.json'),'[]');writeFileSync(join(dir,'fwd.json'),JSON.stringify({predictions:[],grades:[]}));
 execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry','research/engine/registry.json',
  '--out',join(dir,'out'),'--now',NOW,'--sports-rows',join(dir,'rows.json'),'--forward-input',join(dir,'fwd.json')],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
 const report=JSON.parse(readFileSync(join(dir,'out','report.json'),'utf8'));
 assert.equal(report.status,'OK');
 assert.equal(report.evidence.inputs.sports,'CONNECTED');assert.equal(report.evidence.inputs.stocks,'NOT_SUPPLIED');
 assert.ok(report.evidence.gaps.some(g=>g.code==='STOCK_EVIDENCE_NOT_SUPPLIED'),'active stock experiments without stock input are reported');
 const seed=JSON.parse(readFileSync(new URL('research/engine/registry.json',ROOT),'utf8'));
 assert.equal(report.evidence.experiments.total,seed.experiments.length);
 const out=JSON.parse(readFileSync(join(dir,'out','registry.json'),'utf8'));
 for(const e of seed.experiments)assert.equal(out.experiments.find(x=>x.id===e.id)?.status,e.status);
});
