import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDetails,parseSportsFeed,marketProbability,latestQuote} from './dashboard-snapshot.ts';

const game={id:1,starts_at:'2026-10-21T23:30:00Z',home:{name:'Boston Celtics'},away:{name:'New York Knicks'},leagues:{sport_code:'nba'}};
test('valid forecast and settled position rows are extracted',()=>{
 const d=snapshotDetails({predictions:[{id:7,game_id:1,home_probability:0.61,published_at:'2026-10-20T10:00:00Z',starts_at:'2026-10-21T23:30:00Z',games:game}],
  paper:{pending_bets:0,settled_bets:1,win_rate:1,equity_cents:1010000,profit_cents:10000,initial_cents:1000000,roi:0.1,wins:1,losses:0,
   positions:[{id:3,selection:'Boston Celtics',american_odds:-120,stake_cents:10000,placed_at:'2026-10-20T11:00:00Z',settlement:{profit_cents:8333,outcome:'won',settled_at:'2026-10-22T03:00:00Z'}}]}});
 assert.equal(d.forecasts.length,1);
 assert.equal(d.forecasts[0].home,'Boston Celtics');
 assert.equal(d.positions[0].settlement.outcome,'won');
 assert.equal(d.equityCents,1010000);
});
test('malformed rows are dropped and malformed figures become null, never zero',()=>{
 const d=snapshotDetails({predictions:[{id:1,game_id:1,home_probability:1.4,published_at:'x',games:game},null,'junk'],
  paper:{pending_bets:0,settled_bets:0,win_rate:null,equity_cents:'abc',roi:Infinity,max_drawdown_fraction:3,
   positions:[{id:1,selection:'A',american_odds:110,stake_cents:0,placed_at:'2026-10-20T11:00:00Z',settlement:null},
    {id:2,selection:'B',american_odds:110,stake_cents:100,placed_at:'2026-10-20T11:00:00Z',settlement:{outcome:'maybe',profit_cents:1,settled_at:'2026-10-20T11:00:00Z'}}]}});
 assert.deepEqual(d.forecasts,[]);
 assert.deepEqual(d.positions,[]);
 assert.equal(d.equityCents,null);
 assert.equal(d.roi,null);
 assert.equal(d.maxDrawdownFraction,null);
});
test('sports feed parser rejects unavailable responses and keeps only valid quotes',()=>{
 assert.equal(parseSportsFeed({status:'unavailable',games:[]}),null);
 const f=parseSportsFeed({status:'stored',fetchedAt:'2026-10-20T10:00:00Z',games:[{id:'9',home:'H',away:'A',startsAt:'2026-10-21T00:00:00Z',bookmakers:[
  {sportsbook:'X',selection:'H',americanOdds:-150,updatedAt:'2026-10-20T09:00:00Z',noVigProbability:0.58},
  {sportsbook:'Y',selection:'H',americanOdds:-140,updatedAt:'2026-10-20T09:30:00Z',noVigProbability:0.56},
  {sportsbook:'Z',selection:'H',americanOdds:'bad',updatedAt:'2026-10-20T09:30:00Z',noVigProbability:0.5},
  {sportsbook:'W',selection:'H',americanOdds:-110,updatedAt:'2026-10-20T08:30:00Z',noVigProbability:null}]}]});
 assert.equal(f.games[0].bookmakers.length,3);
 const m=marketProbability(f.games[0],'H');
 assert.equal(m.books,2);
 assert.ok(Math.abs(m.median-0.57)<1e-12);
 assert.equal(latestQuote(f.games),'2026-10-20T09:30:00Z');
 assert.deepEqual(marketProbability(f.games[0],'A'),{median:null,books:0});
});
