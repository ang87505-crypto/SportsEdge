// Ledger audit grading and the evaluation pipeline's leakage guard. Synthetic TEST-ONLY rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recomputeOutcome} from './audit.ts';
import {itemsFromSeason} from '../../../scripts/lib/learn-history.ts';

test('grading recompute: more, less, tie, DNP void and missing stat are distinct', () => {
 const g={did_not_play:false,points:20,rebounds:7,assists:0};
 assert.equal(recomputeOutcome(19.5,'points',g),'more');
 assert.equal(recomputeOutcome(20.5,'points',g),'less');
 assert.equal(recomputeOutcome(7,'rebounds',g),'tie');
 assert.equal(recomputeOutcome(0.5,'assists',g),'less');            // zero is a real value, not missing
 assert.equal(recomputeOutcome(19.5,'points',{...g,did_not_play:true}),'void_dnp');
 assert.equal(recomputeOutcome(5.5,'rebounds',{...g,rebounds:null}),'missing_stat');
});

test('evaluation items never use a game at or after the predicted game, and future rows never change them', () => {
 const params=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8')).params;
 const row=(i,pts,min=30)=>({athlete:'1',name:'Test',team:'BOS',opponent:'NY',home:i%2===0,game:String(900000+i),
  start:new Date(Date.UTC(2026,10,1+i*2,0)).toISOString(),
  log:{gameStart:new Date(Date.UTC(2026,10,1+i*2,0)).toISOString(),minutes:min,didNotPlay:false,points:pts,rebounds:6,assists:4}});
 const rows=Array.from({length:8},(_,i)=>row(i,18+i%3));
 const base=itemsFromSeason(rows,params,()=>null);
 assert.equal(base.violations,0);
 assert.ok(base.items.length>0);
 const future=[...rows.slice(0,6),...rows.slice(6).map(r=>({...r,log:{...r.log,points:60,minutes:48}}))];
 const changed=itemsFromSeason(future,params,()=>null);
 const before=base.items.filter(x=>x.at<rows[6].start),after=changed.items.filter(x=>x.at<rows[6].start);
 assert.deepEqual(after.map(x=>[x.key,x.base]),before.map(x=>[x.key,x.base]));
});
