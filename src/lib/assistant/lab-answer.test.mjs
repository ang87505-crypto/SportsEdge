// Learning Lab and staking answers: built from the committed lab reports and the synthetic TEST-ONLY props fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {labTopic,labAnswer} from './lab-answer.ts';
import {routeQuestion} from './domain.ts';
import {loadLabFrom} from '../server/lab-load-core.ts';
import {explainEntries,accuracyByBand} from '../lab/staking-view.ts';
import {makeRaw,NOW} from './fixtures.mjs';
import {PropsStoreError} from '../server/props-store.ts';

const retro=JSON.parse(readFileSync(new URL('../../../research/lab_sports_ablation_20261112/report.json',import.meta.url),'utf8'));
const staking=JSON.parse(readFileSync(new URL('../../../research/lab_staking_20261112/report.json',import.meta.url),'utf8'));
const view=await loadLabFrom(null,NOW,retro,staking);
const ask=(q,raw=makeRaw())=>labAnswer(q,view,raw,NOW);

test('the owner\'s questions route to the lab before any other topic; existing routes are unchanged',()=>{
 for(const [q,t] of [['What did our AI learn yesterday?','learned'],['Which features actually improve our predictions?','features'],
  ['Why did the Booker prediction fail?','player_fail'],['What mistakes are we learning to prevent?','mistakes'],['How much better is the new model?','better'],
  ['Are our probabilities becoming more accurate?','calibration'],['Did psychology improve our stock predictions?','psychology'],
  ['Are we making more virtual money, or just predicting more correctly?','money_vs_accuracy'],['Why was this entry $2 instead of $5?','stake_why'],
  ['Which lineup has the highest estimated expected value?','stake_best_ev'],['How much virtual money are we risking today?','stake_risk_today'],
  ['Would flat staking have performed better?','stake_flat'],['How accurate are our 80% predictions actually?','calibration'],
  ['What happens if our probabilities are overconfident?','stake_overconfident'],['Why did we skip a high-confidence entry?','skip_high_conf']]){
  assert.equal(labTopic(q),t,q);
  assert.deepEqual(routeQuestion(q,null),{domain:'all',topic:'lab'},q);
 }
 for(const q of ["Tonight's picks",'What did the stock model learn?','Is everything running?','Stock bot status','Why no picks today?'])assert.equal(labTopic(q),null,q);
});
test('features: names the measured layers with retrospective numbers, keeps proxy and forward evidence apart',()=>{
 const r=ask('Which features actually improve our predictions?');
 assert.match(r.text,/Recalibration/);assert.match(r.text,/Holm/);assert.match(r.text,/proxy/i);
 assert.match(r.text,/not switched on yet|could not be read|Forward/);
 const table=r.cards.find(c=>c.kind==='table');
 assert.equal(table.rows.length,5);
 assert.ok(table.rows.find(x=>x[0]==='Injury / rotation').includes('Not tested'));
});
test('learned: with no forward records it says nothing new was learned instead of inventing progress',()=>{
 const r=ask('What did our AI learn yesterday?');
 assert.match(r.text,/Nothing new was learned in the last day/);
 assert.match(r.text,/retrospective/);
});
test('mistakes: patterns come with their pre-lock availability and the good picks a skip rule would also reject',()=>{
 const r=ask('What mistakes are we learning to prevent?');
 assert.match(r.text,/minutes/i);assert.match(r.text,/also rejects \d+ good picks/);assert.match(r.text,/No psychology or motive is inferred/);
});
test('player failure: explains a stored graded line from saved inputs; unknown players get a clear refusal',()=>{
 const raw=makeRaw();
 const r=labAnswer('Why did the Last Night Player 12 prediction fail?',view,raw,NOW);
 assert.match(r.text,/Last Night Player 12 points/);assert.match(r.text,/The prediction missed/);assert.match(r.text,/expected minutes 32/);
 assert.match(labAnswer('Why did the Wembanyama prediction fail?',view,raw,NOW).text,/Name a player with a graded line/);
});
test('80% accuracy: observed vs stated from real graded picks, with an interval, and a bar chart',()=>{
 const a=accuracyByBand(makeRaw());
 assert.equal(a.picks,14);
 const band=a.bands.find(b=>b.n);assert.equal(band.hitRate,0.6429);assert.ok(band.lower<band.hitRate&&band.upper>band.hitRate);
 const r=ask('How accurate are our 80% predictions actually?');
 assert.match(r.text,/not a verified 80%/);assert.ok(r.cards.some(c=>c.kind==='bars'));
});
test('stakes: the live stake is the recorded $5; research amounts are labelled shadow and explained',()=>{
 const raw=makeRaw();
 const ex=explainEntries(raw);
 assert.ok(ex.length>0);
 assert.ok(ex.every(e=>e.liveStakeCents===500&&e.research.flat.stakeCents===500));
 // Only 14 real graded picks exist: far too few to size on, so every research method declines.
 assert.ok(ex.every(e=>['confidence','expected_value','kelly','edge_gate'].every(m=>e.research[m].stakeCents===0)));
 const r=ask('Why was this entry $2 instead of $5?',raw);
 assert.match(r.text,/LIVE virtual stake was \$5\.00/);assert.match(r.text,/RESEARCH recommendation/);assert.match(r.text,/never placed/);
 assert.ok(r.cards.find(c=>c.kind==='table').rows[0][0].startsWith('Live'));
});
test('risk today, best EV, skipped high confidence, flat vs variable, overconfidence: all grounded and labelled',()=>{
 assert.match(ask('How much virtual money are we risking today?').text,/Live virtual stakes today: \$/);
 assert.match(ask('Which lineup has the highest estimated expected value?').text,/stake \$0|not a promise/);
 assert.match(ask('Why did we skip a high-confidence entry?').text,/ABOVE 80%/);
 const flat=ask('Would flat staking have performed better?');
 assert.match(flat.text,/no method is better than flat/);assert.match(flat.text,/Live stakes stay at a flat \$5/);
 const over=ask('What happens if our probabilities are overconfident?');
 assert.match(over.text,/−6 pts/);assert.ok(over.cards.some(c=>c.kind==='table'));
});
test('money vs accuracy are reported separately; psychology says no evidence yet',()=>{
 const r=ask('Are we making more virtual money, or just predicting more correctly?');
 assert.match(r.text,/Accuracy:/);assert.match(r.text,/Money:/);assert.match(r.text,/Pick6 payouts are unknown/);
 assert.match(ask('Did psychology improve our stock predictions?').text,/no evidence either way|Monday/);
});
test('a lab not migrated in production is reported as not switched on, never as zero results',async()=>{
 const store={select:async t=>{if(t.startsWith('props_lab_'))throw new PropsStoreError('DB_42P01',true);return [];},insert:async()=>[],rpc:async()=>({})};
 const v=await loadLabFrom(store,NOW,retro,staking);
 assert.equal(v.forwardStatus,'not_migrated');
 assert.match(labAnswer('Which features actually improve our predictions?',v,null,NOW).text,/props_lab_v1\.sql/);
});
test('lineup choice is explained from the saved entry: legs, the pick rule, the entry rule, the live stake and the result',()=>{
 assert.equal(labTopic('Why did we choose this lineup?'),'lineup_why');
 const r=ask('Why did we choose this lineup?');
 assert.match(r.text,/frozen pick rule/);assert.match(r.text,/different games/);assert.match(r.text,/live flat \$5/);
 assert.ok(r.cards.some(c=>c.kind==='table'));
});
test('"why didn\'t we trade" is a stock question (owner-only details), not an ambiguous prompt',()=>{
 assert.equal(routeQuestion("Why didn't we trade?",null).domain,'stocks');
 assert.equal(routeQuestion('How is daily trading doing?',null).domain,'research');
});
