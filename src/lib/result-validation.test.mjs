import test from 'node:test';import assert from 'node:assert/strict';import {verifiedFinal} from './result-validation.ts';
const target={startsAt:'2026-10-20T19:00:00Z',home:'Detroit Pistons',away:'Boston Celtics'};
const event=()=>({date:target.startsAt,season:{type:2},competitions:[{status:{type:{completed:true,name:'STATUS_FINAL'}},competitors:[{homeAway:'home',team:{displayName:target.home},score:'100'},{homeAway:'away',team:{displayName:target.away},score:'90'}]}]});
test('Exact final identity produces scores',()=>assert.deepEqual(verifiedFinal({events:[event()]},target),{homeScore:100,awayScore:90}));
test('Preseason, incomplete and shifted schedules do not settle',()=>{for(const modify of [e=>e.season.type=1,e=>e.competitions[0].status.type.completed=false,e=>e.date='2026-10-21T19:00Z']){const e=event();modify(e);assert.equal(verifiedFinal({events:[e]},target),null);}});
test('Wrong home/away identity cannot settle',()=>{const e=event();e.competitions[0].competitors[0].team.displayName=target.away;assert.equal(verifiedFinal({events:[e]},target),null);});
test('Duplicate and tied finals fail closed',()=>{assert.throws(()=>verifiedFinal({events:[event(),event()]},target));const e=event();e.competitions[0].competitors[1].score='100';assert.throws(()=>verifiedFinal({events:[e]},target));});
