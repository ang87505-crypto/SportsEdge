import test from 'node:test';
import assert from 'node:assert/strict';
import {closingLine,betClv,summarizeClv} from './clv.ts';

const bet={id:1,selection:'Boston Celtics',opponent:'New York Knicks',sportsbook:'DK',americanOdds:+120,startsAt:'2026-10-21T23:30:00Z'};
const q=(selection,americanOdds,observedAt,sportsbook='DK')=>({sportsbook,selection,americanOdds,observedAt});

test('close is the latest complete two-way pregame snapshot at the same book',()=>{
 const quotes=[q('Boston Celtics',120,'2026-10-21T12:00:00Z'),q('New York Knicks',-140,'2026-10-21T12:00:00Z'),
  q('Boston Celtics',105,'2026-10-21T22:00:00Z'),q('New York Knicks',-125,'2026-10-21T22:00:00Z'),
  q('Boston Celtics',100,'2026-10-21T23:00:00Z'),                                   // one-sided: skipped
  q('Boston Celtics',-110,'2026-10-21T23:45:00Z'),q('New York Knicks',-110,'2026-10-21T23:45:00Z'), // after tip-off
  q('Boston Celtics',150,'2026-10-21T22:30:00Z','FD'),q('New York Knicks',-170,'2026-10-21T22:30:00Z','FD')]; // other book
 const c=closingLine(quotes,bet);
 assert.equal(c.observedAt,'2026-10-21T22:00:00Z');
 assert.equal(c.americanOdds,105);
 assert.equal(c.minutesBeforeStart,90);
 assert.ok(c.probability>0.45&&c.probability<0.5);
 assert.equal(closingLine([q('Boston Celtics',120,'2026-10-21T12:00:00Z')],bet),null);
});

test('beating the close gives positive price CLV; closing EV uses the margin-free close',()=>{
 const close={americanOdds:105,opponentOdds:-125,observedAt:'x',minutesBeforeStart:90,probability:0.47};
 const r=betClv(bet,close);
 assert.ok(r.beatClose);
 assert.ok(Math.abs(r.priceClv-(2.2/2.05-1))<1e-12);
 assert.ok(Math.abs(r.closingEv-(0.47*2.2-1))<1e-12);
 const worse=betClv({...bet,americanOdds:100},close);
 assert.equal(worse.beatClose,false);
 assert.ok(worse.priceClv<0);
});

test('summary reports coverage, beat rate and a deterministic interval; empty input stays unmeasured',()=>{
 const close={americanOdds:105,opponentOdds:-125,observedAt:'x',minutesBeforeStart:60,probability:0.47};
 const items=[betClv(bet,close),betClv({...bet,id:2,americanOdds:100},close),betClv({...bet,id:3,americanOdds:130},close)];
 const s=summarizeClv(5,items);
 assert.equal(s.bets,5);assert.equal(s.withClose,3);
 assert.equal(s.beatCloseRate,2/3);
 assert.ok(s.interval[0]<=s.meanClosingEv&&s.meanClosingEv<=s.interval[1]);
 assert.deepEqual(summarizeClv(5,items),s);
 assert.deepEqual(summarizeClv(4,[]),{bets:4,withClose:0,beatCloseRate:null,meanClosingEv:null,interval:null,medianMinutesBeforeStart:null});
});

test('invalid timestamps fail closed',()=>{
 assert.throws(()=>closingLine([q('Boston Celtics',120,'not a date')],bet));
});
