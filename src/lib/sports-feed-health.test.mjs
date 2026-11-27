import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteAge,sportsFeedHealth,QUOTE_DISPLAY_MAX_AGE_MS} from './sports-feed-health.ts';

const now=Date.parse('2026-11-26T20:00:00Z');
const stamp=age=>new Date(now-age).toISOString();
const game=(...times)=>({id:'1',home:'Home',away:'Away',startsAt:'2026-11-27T20:00:00Z',
 bookmakers:times.map((updatedAt,i)=>({sportsbook:'book-'+i,selection:'Home',americanOdds:100,updatedAt,noVigProbability:null}))});

test('the 24-hour display-age boundary is inclusive',()=>{
 assert.equal(quoteAge(stamp(QUOTE_DISPLAY_MAX_AGE_MS),now),'recent');
 assert.equal(quoteAge(stamp(QUOTE_DISPLAY_MAX_AGE_MS+1),now),'stale');
 assert.equal(quoteAge(stamp(10_000),now),'recent');
});
test('future or invalid timestamps and an unavailable clock never look recent',()=>{
 for(const value of ['invalid',stamp(-61_000)])assert.equal(quoteAge(value,now),'unverified');
 for(const clock of [0,NaN,Infinity])assert.equal(quoteAge(stamp(0),clock),'unverified');
 // useNow rounds down to the minute; tolerate only that display rounding.
 assert.equal(quoteAge(stamp(-59_999),now),'recent');
});
test('a fresh quote cannot hide older books on the same game',()=>{
 const h=sportsFeedHealth([game(stamp(1_000),stamp(48*3600_000))],now);
 assert.equal(h.state,'mixed');
 assert.deepEqual([h.recent,h.stale,h.unverified,h.quotes],[1,1,0,2]);
 assert.equal(h.newest,stamp(1_000));assert.equal(h.oldest,stamp(48*3600_000));
});
test('a fresh game cannot hide a stale game elsewhere on the board',()=>{
 const h=sportsFeedHealth([game(stamp(1_000)),{...game(stamp(48*3600_000)),id:'2'}],now);
 assert.equal(h.state,'mixed');assert.equal(h.stale,1);assert.equal(h.quotedGames,2);
});
test('all stale prices remain visible as historical saved quotes',()=>{
 const h=sportsFeedHealth([game(stamp(48*3600_000),stamp(72*3600_000))],now);
 assert.equal(h.state,'stale');assert.equal(h.quotes,2);assert.equal(h.recent,0);
});
test('empty saved games do not establish that the real-world slate is empty',()=>{
 const h=sportsFeedHealth([],now);
 assert.equal(h.state,'empty');assert.equal(h.newest,null);assert.equal(h.quotes,0);
});
test('saved fixtures without quotes differ from an empty fixture feed',()=>{
 const h=sportsFeedHealth([game()],now);
 assert.equal(h.state,'no-prices');assert.equal(h.games,1);assert.equal(h.withoutPrices,1);
});
test('unpriced games prevent an all-recent board status',()=>{
 const h=sportsFeedHealth([game(stamp(1_000)),{...game(),id:'2'}],now);
 assert.equal(h.state,'partial');assert.equal(h.quotedGames,1);assert.equal(h.withoutPrices,1);
});
test('one future quote prevents a verified age status for the entire board',()=>{
 const h=sportsFeedHealth([game(stamp(1_000),stamp(-3600_000))],now);
 assert.equal(h.state,'unverified');assert.equal(h.recent,1);assert.equal(h.unverified,1);
});
test('inspection does not modify source prices or probabilities',()=>{
 const source=[game(stamp(48*3600_000))],before=structuredClone(source);
 sportsFeedHealth(source,now);assert.deepEqual(source,before);
});
