import test from 'node:test';
import assert from 'node:assert/strict';
import {noVigMore,marketView,LAGGING_LINE_GAP,PROS_DISAGREE_MIN} from './market.ts';

// Synthetic TEST-ONLY quotes.
const q=(book,player,line,over,under,o={})=>({bookmakerKey:book,providerEventId:'evtTEST000001',playerName:player,stat:'points',
 marketKey:'player_points',line,overPrice:over,underPrice:under,providerLastUpdate:'2026-11-07T19:30:00.000Z',
 ingestedAt:'2026-11-07T20:00:00.000Z',lockAt:'2026-11-08T00:00:00.000Z',responseSha256:'a'.repeat(64),...o});
const obs={providerEventId:'evtTEST000001',playerName:'Player A',stat:'points',line:24.5};

test('constants match the spec',()=>{
 assert.equal(LAGGING_LINE_GAP,1.0);
 assert.equal(PROS_DISAGREE_MIN,0.55);
});

test('noVigMore removes the bookmaker margin',()=>{
 assert.equal(noVigMore(-110,-110),0.5);
 assert.ok(Math.abs(noVigMore(-150,130)-0.57983)<1e-5);
});

test('books at the same line are averaged',()=>{
 const v=marketView(obs,[q('draftkings','Player A',24.5,-110,-110),q('fanduel','Player A',24.5,-150,130)],null);
 assert.equal(v.booksAtSameLine,2);
 assert.ok(Math.abs(v.pMoreBooks-(0.5+noVigMore(-150,130))/2)<1e-12);
 assert.equal(v.lineGap,0);
 assert.deepEqual(v.flags,[]);
});

test('no same-line book gives the gap to the nearest line and flags a lagging line',()=>{
 const v=marketView(obs,[q('draftkings','Player A',25.5,-110,-110),q('fanduel','Player A',27.5,-110,-110)],'more');
 assert.equal(v.booksAtSameLine,0);
 assert.equal(v.pMoreBooks,null);
 assert.equal(v.nearestBookLine,25.5);
 assert.equal(v.lineGap,1);
 assert.deepEqual(v.flags,['lagging_line']);
});

test('pros disagree only when the books lean the other way by at least 0.55',()=>{
 const books=[q('draftkings','Player A',24.5,-150,130)];
 assert.deepEqual(marketView(obs,books,'less').flags,['pros_disagree']);
 assert.deepEqual(marketView(obs,books,'more').flags,[]);
 assert.deepEqual(marketView(obs,books,null).flags,[]);
 assert.deepEqual(marketView(obs,[q('draftkings','Player A',24.5,-115,-105)],'less').flags,[]);
});

test('a differently spelled player never borrows another player\'s odds',()=>{
 const v=marketView({...obs,playerName:'Nic Claxton'},[q('draftkings','Nicolas Claxton',24.5,-150,130)],'less');
 assert.deepEqual(v,{booksAtSameLine:0,pMoreBooks:null,nearestBookLine:null,lineGap:null,flags:[]});
});

test('accents and suffixes still match the same player',()=>{
 const v=marketView({...obs,playerName:'Luka Doncic'},[q('draftkings','Luka Dončić',24.5,-110,-110)],null);
 assert.equal(v.booksAtSameLine,1);
});

test('quotes from another event or stat are ignored',()=>{
 const v=marketView(obs,[q('draftkings','Player A',24.5,-150,130,{providerEventId:'evtOTHER0001'}),
  q('fanduel','Player A',24.5,-150,130,{stat:'rebounds',marketKey:'player_rebounds'})],'less');
 assert.equal(v.booksAtSameLine,0);
 assert.equal(v.nearestBookLine,null);
});
