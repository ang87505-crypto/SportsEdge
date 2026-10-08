import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalOdds,noVig,performance} from './research-math.ts';
test('American price conversions',()=>{assert.equal(decimalOdds(150),2.5);assert.equal(decimalOdds(-200),1.5);assert.throws(()=>decimalOdds(-99));assert.throws(()=>decimalOdds(NaN));});
test('No-vig includes entire market',()=>{assert.deepEqual(noVig([-110,-110]),[0.5,0.5]);assert.ok(Math.abs(noVig([100,200,300]).reduce((a,b)=>a+b,0)-1)<1e-12);assert.throws(()=>noVig([100]));});
test('No settlements produces unavailable rates',()=>{const p=performance(100000,[],1000);assert.equal(p.available_cents,99000);assert.equal(p.roi,null);assert.equal(p.win_rate,null);});
test('Settled return and drawdown use actual order and exclude void turnover',()=>{const p=performance(100000,[{stake_cents:1000,profit_cents:-1000,outcome:'lost',settled_at:'2026-01-02T00:00Z'},{stake_cents:1000,profit_cents:1500,outcome:'won',settled_at:'2026-01-01T00:00Z'},{stake_cents:500,profit_cents:0,outcome:'void',settled_at:'2026-01-03T00:00Z'}],1000);assert.equal(p.profit_cents,500);assert.equal(p.roi,0.25);assert.equal(p.win_rate,0.5);assert.equal(p.max_drawdown_cents,1000);assert.equal(p.available_cents,99500);});
test('Impossible exposure and malformed settlement rejected',()=>{assert.throws(()=>performance(100,[],101));assert.throws(()=>performance(100,[{stake_cents:10,profit_cents:1,outcome:'void',settled_at:'bad'}],0));});
