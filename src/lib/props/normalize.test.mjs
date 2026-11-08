import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePropEvent,parseEventList,canonicalJson} from './normalize.ts';

// Synthetic fixture only (TEST-ONLY identifiers). Never a genuine observation.
const listed={id:'evtTEST000001',commenceTime:'2026-11-08T00:00:00Z',homeTeam:'Test Home',awayTeam:'Test Away'};
const now='2026-11-07T20:00:00.000Z';
const pair=(player,point,extra={})=>[
 {name:'Over',description:player,price:-137,point,...extra},
 {name:'Under',description:player,price:-137,point,...extra}];
const event=(books)=>({id:listed.id,sport_key:'basketball_nba',commence_time:listed.commenceTime,
 home_team:'Test Home',away_team:'Test Away',bookmakers:books});
const book=(key,markets)=>({key,title:key,markets});
const market=(key,outcomes,last='2026-11-07T19:30:00Z')=>({key,last_update:last,outcomes});

test('admits complete standard lines for both platforms with lock and hash evidence',()=>{
 const raw=event([
  book('prizepicks',[market('player_points',pair('Player A',24.5)),market('player_assists',pair('Player A',6.5))]),
  book('pick6',[market('player_rebounds',pair('Player B',9.5,{multiplier:1}))])]);
 const r=normalizePropEvent(raw,listed,now);
 assert.equal(r.observations.length,3);
 assert.deepEqual(r.rejected,[]);
 const pp=r.observations.find(o=>o.platform==='prizepicks'&&o.stat==='points');
 assert.equal(pp.line,24.5);
 assert.equal(pp.lockAt,'2026-11-08T00:00:00.000Z');
 assert.equal(pp.ingestedAt,now);
 assert.equal(pp.providerLastUpdate,'2026-11-07T19:30:00.000Z');
 assert.match(pp.responseSha256,/^[a-f0-9]{64}$/);
 assert.equal(r.observations.find(o=>o.platform==='pick6').overMultiplier,1);
});

test('hash is stable under key reordering and changes with content',()=>{
 assert.equal(canonicalJson({b:1,a:[{d:2,c:3}]}),canonicalJson({a:[{c:3,d:2}],b:1}));
 const a=normalizePropEvent(event([]),listed,now).responseSha256;
 const b=normalizePropEvent(event([book('pick6',[])]),listed,now).responseSha256;
 assert.notEqual(a,b);
});

test('rejects locked, stale, future, mismatched and identity-ambiguous evidence',()=>{
 assert.equal(normalizePropEvent(event([]),listed,'2026-11-07T23:55:00Z').eventLocked,true);
 assert.equal(normalizePropEvent({...event([]),id:'other'},listed,now).rejected[0].reason,'event_mismatch');
 assert.equal(normalizePropEvent({...event([]),home_team:'Renamed'},listed,now).rejected[0].reason,'event_mismatch');
 const r=normalizePropEvent(event([book('prizepicks',[
  market('player_points',pair('Stale',10.5),'2026-11-07T16:00:00Z'),
  market('player_rebounds',pair('Future',10.5),'2026-11-07T20:05:00Z'),
  market('player_assists',[...pair('Twice',4.5),...pair('Twice',5.5)]),
 ])]),listed,now);
 assert.deepEqual(r.rejected.map(x=>x.reason).sort(),['ambiguous_line','ambiguous_line','future_quote','stale_quote']);
 assert.equal(r.observations.length,0);
});

test('rejects specials, incomplete pairs, bad lines, unknown books and alternate markets',()=>{
 const r=normalizePropEvent(event([
  book('prizepicks',[
   market('player_points',pair('Demon',30.5,{multiplier:1.5})),
   market('player_rebounds',[{name:'Over',description:'Half',price:-137,point:7.5}]),
   market('player_assists',pair('Weird',4.3)),
   market('player_points_alternate',pair('Goblin',18.5)),
  ]),
  book('underdog',[market('player_points',pair('Elsewhere',20.5))]),
 ]),listed,now);
 assert.deepEqual(r.rejected.map(x=>x.reason).sort(),
  ['incomplete_pair','invalid_line','invalid_line','special_multiplier','unknown_bookmaker','unsupported_market']);
 assert.equal(r.observations.length,0);
});

test('a quote is never accepted at or after the start, even if listed start differs',()=>{
 // Provider says the game moved earlier: lock follows the earlier start.
 const early={...event([book('pick6',[market('player_points',pair('P',20.5))])]),commence_time:'2026-11-07T20:05:00Z'};
 const r=normalizePropEvent(early,listed,now);
 assert.equal(r.eventLocked,true);
 assert.equal(r.observations.length,0);
});

test('event list excludes started games and invalid ids without relabelling',()=>{
 const r=parseEventList([
  {id:'evtTEST000001',sport_key:'basketball_nba',commence_time:'2026-11-08T00:00:00Z',home_team:'H',away_team:'A'},
  {id:'evtTEST000002',sport_key:'basketball_nba',commence_time:'2026-11-07T19:00:00Z',home_team:'H2',away_team:'A2'},
  {id:'bad id',sport_key:'basketball_nba',commence_time:'2026-11-08T00:00:00Z',home_team:'H3',away_team:'A3'},
  {id:'evtTEST000001',sport_key:'basketball_nba',commence_time:'2026-11-08T00:00:00Z',home_team:'H',away_team:'A'},
 ],now);
 assert.equal(r.events.length,1);
 assert.equal(r.startedOrPast,1);
 assert.equal(r.invalid,2);
 assert.throws(()=>parseEventList({},now));
});

test('eventOddsParams lists platforms then sportsbooks, at most 10 books, one region worth of cost',async()=>{
 const {eventOddsParams}=await import('../server/props-odds-client.ts');
 const {eventOddsWorstCost}=await import('./budget.ts');
 const p=eventOddsParams();
 const books=p.bookmakers.split(',');
 assert.deepEqual(books,['prizepicks','pick6','draftkings','fanduel','betmgm','williamhill_us']);
 assert.ok(books.length<=10);
 assert.equal(p.regions,'us_dfs');
 assert.equal(eventOddsWorstCost(),3);
});
