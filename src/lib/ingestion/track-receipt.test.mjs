import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTrack,summarizeCollection} from './track-receipt.ts';

const base={track:'nba',providerGames:3,gamesStored:3,pricesOffered:12,oddsInserted:0,oddsVerified:0,newestSourceObservedAt:null,
 rejectedEvents:0,skippedLive:0,skippedMarkets:0};
const t=o=>({...base,outcome:o});

test('each sport is classified from its own counts',()=>{
 assert.equal(classifyTrack({...base,oddsInserted:12,oddsVerified:12}),'saved');
 assert.equal(classifyTrack({...base,oddsInserted:12,oddsVerified:11}),'unverified');
 assert.equal(classifyTrack(base),'unchanged');
 assert.equal(classifyTrack({...base,providerGames:0,gamesStored:0,pricesOffered:0}),'empty_slate');
 assert.equal(classifyTrack({...base,pricesOffered:0}),'no_prices');
 assert.equal(classifyTrack({...base,oddsInserted:12,oddsVerified:12,error:'VERIFY_FAILED'}),'store_failed');
 assert.equal(classifyTrack({...base,error:'STORE_FAILED'}),'store_failed');
});
test('run status: one sport\'s save never hides the other sport\'s failure',()=>{
 const s=(nba,soccer)=>summarizeCollection({tracks:{nba:t(nba),soccer:t(soccer)}}).status;
 assert.equal(s('saved','saved'),'refreshed');
 assert.equal(s('saved','empty_slate'),'refreshed');
 assert.equal(s('saved','unchanged'),'refreshed');
 assert.equal(s('unchanged','empty_slate'),'no_new_quotes');
 assert.equal(s('saved','store_failed'),'partial_refresh');
 assert.equal(s('store_failed','saved'),'partial_refresh');
 assert.equal(s('saved','unverified'),'partial_refresh');
 assert.equal(s('unchanged','store_failed'),'refresh_failed');
 assert.deepEqual(summarizeCollection({tracks:{nba:t('saved'),soccer:t('store_failed')}}).tracks,{nba:'saved',soccer:'store_failed'});
});
test('unknown or incomplete report shapes are never success',()=>{
 for(const r of [null,{},{tracks:[]},{tracks:{nba:t('saved')}},{tracks:{nba:t('saved'),soccer:t('ok')}},
  {tracks:{nba:t('saved'),soccer:t('saved'),nfl:t('saved')}},{status:'completed',tracks:{nba:{gamesProcessed:2},soccer:{gamesProcessed:1}}}])
  assert.equal(summarizeCollection(r).status,'refresh_unverified',JSON.stringify(r));
});
