import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEquityPlot} from '../paper-curve.ts';

test('equity chart begins at the real initial virtual bankroll and plots only settled observations',()=>{
  const p=buildEquityPlot(100000,[
    {at:'2026-10-10T12:00:00Z',equity_cents:101000},
    {at:'2026-10-11T12:00:00Z',equity_cents:98500},
  ],600,160);
  assert.equal(p.coordinates.length,3);
  assert.deepEqual(p.coordinates.map(x=>x.x),[0,300,600]);
  assert.ok(p.coordinates[1].y<p.coordinates[0].y);
  assert.ok(p.coordinates[2].y>p.coordinates[0].y);
  assert.match(p.line,/^M0 /);
  assert.match(p.area,/L0 160 Z$/);
  assert.equal(p.coordinates[0].y,p.baselineY);
});
test('flat settled history and no settlement never fabricate return',()=>{
  const empty=buildEquityPlot(10000,[]);
  const flat=buildEquityPlot(10000,[{at:'2026-10-11T12:00:00Z',equity_cents:10000}]);
  assert.equal(empty.coordinates.length,1);
  assert.equal(flat.coordinates[0].y,flat.coordinates[1].y);
  assert.equal(flat.lowCents<10000,true);
  assert.equal(flat.highCents>10000,true);
});
test('rejects corrupt, unordered or impossible ledger values',()=>{
  for(const bad of [
    [{at:'invalid',equity_cents:10000}],
    [{at:'2026-10-11',equity_cents:10000},{at:'2026-10-10',equity_cents:10000}],
    [{at:'2026-10-11',equity_cents:-1}],
    [{at:'2026-10-11',equity_cents:Infinity}],
    [{at:'2026-10-11',equity_cents:1.5}],
  ])assert.throws(()=>buildEquityPlot(10000,bad));
  assert.throws(()=>buildEquityPlot(0,[]));
  assert.throws(()=>buildEquityPlot(10000,[],0,200));
});
