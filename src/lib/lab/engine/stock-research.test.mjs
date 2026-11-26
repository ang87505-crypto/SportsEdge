// Stock research ledgers -> learning engine. SYNTHETIC summaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stockResearchResults} from './stock-research.ts';

const ROOT=new URL('../../../../',import.meta.url);
const v=(weeks,r=null)=>({weeks,pending:1,total_return:r,status:'collecting',latest_session:'2026-11-30'});
const summary=(w=3)=>({lab:{forward:{minWeeks:26,variants:{base:v(w,0.01),'base+market_regime':v(w,-0.02)}}},
 labHoldrank10:{experiment:'lab-stock-holdrank10-wholeshare',forward:{holdrank10:v(w-1,0.005)}}});

test('graded weeks are counted as recorded; below 26 weeks it collects, at 26 the owner applies the registered rule',()=>{
 const r=stockResearchResults(summary());
 assert.deepEqual(r.map(x=>[x.experimentId,x.result.evidence,x.result.disposition,x.result.weeks]),
  [['lab-stock-psychology-v1','forward','NO_CLEAR_EFFECT',3],['lab-stock-holdrank10-wholeshare','forward','NO_CLEAR_EFFECT',2]]);
 assert.match(r[0].result.reason,/3\/26 graded forward weeks/);
 assert.match(stockResearchResults(summary(26))[0].result.reason,/owner applies the pre-registered decision rule/);
 assert.deepEqual(stockResearchResults({}),[]);
 assert.equal(stockResearchResults({lab:{forward:{variants:{base:v(2)}}}}).length,1,'holdrank10 appears only once its ledger exists');
 assert.throws(()=>stockResearchResults({lab:{forward:{variants:{base:{weeks:-1}}}}}),/INVALID_SUMMARY/);
});

test('end to end: running experiments record forward evidence once; a rejected experiment is never revived',()=>{
 const dir=mkdtempSync(join(tmpdir(),'stock-research-'));
 const seed=JSON.parse(readFileSync(new URL('research/engine/registry.json',ROOT),'utf8'));
 writeFileSync(join(dir,'seed.json'),JSON.stringify(seed));writeFileSync(join(dir,'summary.json'),JSON.stringify(summary()));
 const run=(out,reg)=>{execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts','--registry',reg,
  '--out',join(dir,out),'--now','2026-12-01T12:00:00Z','--stock-research',join(dir,'summary.json')],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
  return {rep:JSON.parse(readFileSync(join(dir,out,'report.json'),'utf8')),reg:JSON.parse(readFileSync(join(dir,out,'registry.json'),'utf8'))};};
 const a=run('a',join(dir,'seed.json'));
 assert.equal(a.rep.status,'OK',a.rep.failure);
 const psych=a.reg.experiments.find(e=>e.id==='lab-stock-psychology-v1');
 assert.equal(psych.status,'INSUFFICIENT_DATA','3/26 forward weeks: below the registered minimum');
 assert.equal(a.rep.evidence.inputs.stocks,'CONNECTED');
 assert.ok(!a.rep.evidence.experiments.ownerSuppliedOnly.some(e=>e.id==='lab-stock-psychology-v1'),'fed by the research ledger: not listed as lacking a producer');
 // Same input again: applied once.
 const b=run('b',join(dir,'a','registry.json'));
 assert.equal(b.reg.experiments.find(e=>e.id==='lab-stock-psychology-v1').history.length,psych.history.length);
 // A rejected holdrank10 stays rejected even though its ledger keeps collecting.
 const rej={...seed,experiments:seed.experiments.map(e=>e.id==='lab-stock-holdrank10-wholeshare'?{...e,status:'REJECTED'}:e)};
 writeFileSync(join(dir,'rej.json'),JSON.stringify(rej));
 const c=run('c',join(dir,'rej.json'));
 assert.equal(c.reg.experiments.find(e=>e.id==='lab-stock-holdrank10-wholeshare').status,'REJECTED');
 assert.ok(c.rep.domains.stockResearch.applied.some(x=>x.skipped==='TERMINAL_REJECTED'));
});
