import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrationBins,legEstimate,assessEntry,recommend,compareStaking,forwardStaking,stakingVerdict,winMultiple,METHODS,STAKING_POLICY_V1} from './staking.ts';

const picks=(stated,rate,n)=>Array.from({length:n},(_,i)=>({probability:stated,correct:i<Math.round(rate*n)}));
const wellCalibrated=calibrationBins([...picks(0.62,0.62,400),...picks(0.67,0.67,400),...picks(0.72,0.72,400),...picks(0.78,0.78,400)]);
const overconfident=calibrationBins([...picks(0.62,0.55,400),...picks(0.67,0.56,400),...picks(0.72,0.57,400),...picks(0.78,0.58,400)]);
const entry=(p1,p2,o={})=>({id:'e',date:'2026-11-14',platform:'prizepicks',legs:[{probability:p1,eventId:'g1',playerKey:'a'},{probability:p2,eventId:'g2',playerKey:'b'}],...o});
const fresh={bankrollCents:50000,peakCents:50000,stakedTodayCents:0};

test('a stated 80% is mapped to the hit rate observed at that confidence, with a lower bound',()=>{
 const l=legEstimate(0.78,overconfident);
 assert.equal(l.reliable,true);assert.ok(Math.abs(l.mid-0.58)<0.01);assert.ok(l.low<l.mid);assert.ok(l.gap>0.15);
 assert.equal(legEstimate(0.62,calibrationBins(picks(0.62,0.6,50))).reliable,false);
});
test('every method stays within $5, whole dollars, and the live daily limit',()=>{
 const a=assessEntry(entry(0.78,0.78),wellCalibrated);
 for(const m of METHODS){
  const r=recommend(m,a,fresh);
  assert.ok(r.stakeCents>=0&&r.stakeCents<=500&&r.stakeCents%100===0,m);
  assert.equal(recommend(m,a,{...fresh,stakedTodayCents:STAKING_POLICY_V1.dailyRiskCents}).stakeCents,0,m+' daily limit');
 }
 assert.equal(recommend('flat',a,fresh).stakeCents,500);
});
test('a confident model with overconfident evidence gets $0 from every research method; flat stays $5',()=>{
 const a=assessEntry(entry(0.78,0.78),overconfident);
 assert.ok(a.evLow<=0);
 for(const m of METHODS.filter(m=>m!=='flat'))assert.equal(recommend(m,a,fresh).stakeCents,0,m);
 assert.equal(recommend('flat',a,fresh).stakeCents,500);
});
test('more stated confidence never forces a bigger stake by itself',()=>{
 const low=assessEntry(entry(0.62,0.62),overconfident),high=assessEntry(entry(0.78,0.78),overconfident);
 for(const m of ['confidence','expected_value','kelly','edge_gate'])assert.ok(recommend(m,high,fresh).stakeCents<=500&&recommend(m,high,fresh).stakeCents===0);
 assert.equal(recommend('expected_value',low,fresh).stakeCents,0);
});
test('a small edge gives a partial stake; drawdown halves then stops research stakes',()=>{
 const bins=calibrationBins([...picks(0.62,0.62,2000),...picks(0.67,0.66,2000)]);
 const a=assessEntry(entry(0.67,0.67),bins);
 const ev=recommend('expected_value',a,fresh).stakeCents;
 assert.ok(ev>0&&ev<500,'partial: '+ev);
 assert.ok(recommend('expected_value',a,{...fresh,bankrollCents:44000}).stakeCents<=ev/2+100);
 assert.equal(recommend('expected_value',a,{...fresh,bankrollCents:39000}).reason,'drawdown_stop');
});
test('Kelly refuses when stated confidence is far from what was observed',()=>{
 const bins=calibrationBins([...picks(0.78,0.71,2000)]);
 assert.equal(recommend('kelly',assessEntry(entry(0.78,0.78),bins),fresh).reason,'calibration_not_reliable_for_kelly');
});
test('Pick6 has no published payout table: research methods stake $0 and it is never scored as money',()=>{
 assert.equal(winMultiple('pick6',2),null);assert.equal(winMultiple('prizepicks',2),3);
 const a=assessEntry(entry(0.78,0.78,{platform:'pick6'}),wellCalibrated);
 assert.equal(recommend('expected_value',a,fresh).reason,'payout_terms_unknown');
 const c=compareStaking([{...entry(0.78,0.78,{platform:'pick6'}),legResults:['win','win']}],wellCalibrated);
 assert.equal(c.entries,0);assert.equal(c.payoutUnknownExcluded,1);
});
test('all methods size the SAME entries; flat reproduces the live $5 settlement',()=>{
 const es=Array.from({length:40},(_,i)=>({...entry(0.72,0.72),id:'e'+i,date:'2026-11-'+String(1+(i%20)).padStart(2,'0'),legResults:i%2?['win','win']:['win','loss']}));
 const c=compareStaking(es,wellCalibrated);
 assert.ok(c.methods.every(m=>m.entries===40));
 const flat=c.methods.find(m=>m.method==='flat');
 assert.equal(flat.pnlCents,20*1000-20*500);
 assert.ok(stakingVerdict(c,'retrospective').every(v=>v.verdict!=='better_than_flat_forward'));
 assert.equal(c.sensitivity.length,4);
 // More overconfidence (bigger shift) can only lower flat's expected P&L.
 const f=c.sensitivity.map(s=>s.methods.find(m=>m.method==='flat').expectedPnlCents);
 assert.ok(f[0]>=f[3]);
});
test('forward staking: pending and Pick6 are not valued; small samples are only "collecting"',()=>{
 const rows=[{entryId:'1',date:'2026-11-14',platform:'prizepicks',liveStakeCents:500,stakes:{flat:500,expected_value:200,kelly:0,confidence:300,edge_gate:500},legResults:['win','win']},
  {entryId:'2',date:'2026-11-14',platform:'pick6',liveStakeCents:500,stakes:{flat:500},legResults:['win','loss']},
  {entryId:'3',date:'2026-11-15',platform:'prizepicks',liveStakeCents:500,stakes:{flat:500},legResults:null}];
 const f=forwardStaking(rows);
 assert.deepEqual([f.settled,f.pending,f.payoutUnknown],[1,1,1]);
 assert.equal(f.methods.find(m=>m.method==='flat').pnlCents,1000);
 assert.equal(f.methods.find(m=>m.method==='expected_value').pnlCents,400);
 assert.ok(f.verdicts.every(v=>v.verdict==='collecting'));
 assert.equal(f.liveStakeMatchesFlat,true);
});
