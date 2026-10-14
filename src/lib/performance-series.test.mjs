import test from 'node:test';
import assert from 'node:assert/strict';
import {realizedSeries} from './performance-series.ts';

test('only recorded realized outcomes produce chart events, in settlement order',()=>{
 const input=[
  {id:'second',at:'2026-10-12T00:00:00Z',profitCents:-2500},
  {id:'first',at:'2026-10-11T00:00:00Z',profitCents:3000},
  {id:'third',at:'2026-10-13T00:00:00Z',profitCents:1200}
 ];
 const result=realizedSeries(100000,input);
 assert.deepEqual(result.map(x=>x.profitCents),[0,3000,500,1700]);
 assert.deepEqual(result.map(x=>x.equityCents),[100000,103000,100500,101700]);
 assert.deepEqual(result.map(x=>x.eventId),['opening-balance','first','second','third']);
 assert.equal(input[0].id,'second');
});
test('no events returns no curve, never creates fake balance history',()=>{
 assert.deepEqual(realizedSeries(100000,[]),[]);
});
test('same timestamp sorted deterministically by event identity',()=>{
 const result=realizedSeries(1000,[{id:'b',at:'2026-10-12',profitCents:10},{id:'a',at:'2026-10-12',profitCents:20}]);
 assert.deepEqual(result.map(x=>x.eventId),['opening-balance','a','b']);
});
test('invalid input and duplicate records fail closed',()=>{
 const start={id:'a',at:'2026-10-12',profitCents:2};
 assert.throws(()=>realizedSeries(NaN,[start]));
 assert.throws(()=>realizedSeries(100,[start,start]));
 assert.throws(()=>realizedSeries(100,[{...start,at:'not-a-date'}]));
 assert.throws(()=>realizedSeries(100,[{...start,profitCents:NaN}]));
 assert.throws(()=>realizedSeries(Number.MAX_SAFE_INTEGER,[start]));
 assert.throws(()=>realizedSeries(100,Array.from({length:1001},(_,i)=>({...start,id:String(i)}))));
});
