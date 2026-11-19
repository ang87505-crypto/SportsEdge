// Every saved prediction, graded, picked or not. Synthetic TEST-ONLY ledger (src/lib/assistant/fixtures.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardPredictions,summarizeModels,decisionCategories,newestModel} from './forward-predictions.ts';
import {makeRaw,NOW} from '../assistant/fixtures.mjs';
import {labAnswer,labTopic} from '../assistant/lab-answer.ts';
import {routeQuestion} from '../assistant/domain.ts';
import {loadLabFrom} from '../server/lab-load-core.ts';
import {readFileSync} from 'node:fs';

function withExtras(){
 const raw=makeRaw();
 // A learning challenger scored two of last night's lines (one would qualify, one would not), and the same line
 // appears again on Pick6: it must be kept as a row but counted once.
 const o1=raw.observations.find(o=>o.id===1),o2=raw.observations.find(o=>o.id===2);
 raw.predictions.push({id:9001,observation_id:1,model_version:'props-learn-v3',status:'scored',reason:'ok',p_more:0.7,p_less:0.29,p_tie:0.01,mean:22,inputs:{}},
  {id:9002,observation_id:2,model_version:'props-learn-v3',status:'scored',reason:'ok',p_more:0.55,p_less:0.44,p_tie:0.01,mean:21,inputs:{}},
  {id:9003,observation_id:3,model_version:'props-learn-v2',status:'scored',reason:'ok',p_more:0.62,p_less:0.37,p_tie:0.01,mean:21,inputs:{}});
 raw.observations.push({...o1,id:901,platform:'pick6'});
 raw.predictions.push({id:9004,observation_id:901,model_version:'props-nb-minutes-rate-v1',status:'scored',reason:'ok',p_more:0.66,p_less:0.33,p_tie:0.01,mean:21,inputs:{}});
 raw.results.push({observation_id:901,revision:1,outcome:'more',actual:25});
 // An unscorable line still counts as observed, with no forecast row.
 raw.observations.push({...o2,id:902,player_name:'No History',provider_event_id:'evtTESTY00009'});
 raw.predictions.push({id:9005,observation_id:902,model_version:'props-nb-minutes-rate-v1',status:'unscorable',reason:'insufficient_history',p_more:null,p_less:null,p_tie:null,mean:null,inputs:{}});
 return raw;
}

test('every scored prediction is listed and graded, picked or not; duplicates kept as rows but counted once',()=>{
 const fp=forwardPredictions(withExtras());
 assert.equal(fp.unscorable,1);
 const dup=fp.rows.filter(x=>x.key===fp.rows.find(r=>r.observationId===901).key&&x.modelVersion==='props-nb-minutes-rate-v1');
 assert.equal(dup.length,2);assert.equal(dup.filter(x=>x.duplicate).length,1);
 const skipped=fp.rows.find(x=>x.player==='Last Night Skipped');
 assert.equal(skipped.decision,'skipped');assert.equal(skipped.outcome,'win');assert.equal(skipped.qualifies,false);
 assert.ok(fp.rows.some(x=>x.modelVersion==='props-learn-v3'&&x.decision==='no_decision'&&x.outcome!=='pending'));
 assert.ok(fp.rows.filter(x=>x.lockAt>NOW).every(x=>x.outcome==='pending'));
});
test('metrics use unique lines across the full prediction set; decisions are separate categories',()=>{
 const fp=forwardPredictions(withExtras());
 const base=summarizeModels(fp.rows).find(m=>m.modelVersion==='props-nb-minutes-rate-v1');
 // 15 unique graded last-night lines (14 picks + 1 skip); the Pick6 copy of line 1 is not a 16th.
 assert.equal(base.graded,15);assert.equal(base.wins,9+(0.52>=0.5?1:0));
 assert.ok(base.hitLower<base.hitRate&&base.hitUpper>base.hitRate);assert.ok(base.brier>0&&base.logLoss>0);
 const c=decisionCategories(fp.rows.filter(x=>x.date==='2026-11-08'));
 assert.equal(c.skipped.n,1);
 assert.equal(c.entered.n+c.qualifiedNotEntered.n,14);
 assert.equal(c.all.n,15);
 assert.ok(c.entered.n>0&&c.qualifiedNotEntered.n>0);
 assert.equal(newestModel(fp.rows),'props-learn-v3');
});
const retro=JSON.parse(readFileSync(new URL('../../../research/lab_sports_ablation_20261112/report.json',import.meta.url),'utf8'));
const staking=JSON.parse(readFileSync(new URL('../../../research/lab_staking_20261112/report.json',import.meta.url),'utf8'));
const view=await loadLabFrom(null,NOW,retro,staking);
test('chat: all predictions yesterday (including unbet), accuracy by model, newest AI choices',()=>{
 for(const [q,t] of [["How did all our predictions do yesterday, including ones we didn't bet?",'all_predictions'],['What was our accuracy by model?','accuracy_by_model'],
  ['Which predictions would our newest AI have chosen?','newest_choices']]){assert.equal(labTopic(q),t,q);assert.equal(routeQuestion(q,null).topic,'lab');}
 const raw=withExtras();
 const a=labAnswer("How did all our predictions do yesterday, including ones we didn't bet?",view,raw,NOW);
 assert.match(a.text,/Yesterday \(2026-11-08, Eastern\)/);assert.match(a.text,/count once/);assert.match(a.text,/skipped by the pick rule 1/);assert.match(a.text,/not returns/);
 const b=labAnswer('What was our accuracy by model?',view,raw,NOW);
 assert.match(b.text,/props-nb-minutes-rate-v1/);assert.match(b.text,/props-learn-v3/);assert.ok(b.cards.some(c=>c.kind==='table'));
 const c=labAnswer('Which predictions would our newest AI have chosen?',view,raw,NOW);
 assert.match(c.text,/props-learn-v3 is the newest/);assert.match(c.text,/never entries/);
 assert.equal(c.cards.find(x=>x.kind==='table').rows.length,1);
 assert.match(labAnswer('Which predictions would our newest AI have chosen?',view,makeRaw(),NOW).text,/No learning challenger/);
});
