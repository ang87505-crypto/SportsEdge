import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectJournalBackup,MAX_BACKUP_BYTES} from './journal-backup.ts';
import {EMPTY,openTrade,closeTrade} from './journal.ts';

const t={id:'manual-1',symbol:'AAPL',shares:2,entryCents:10000,openedAt:'2026-10-09T00:00:00Z',note:'Manual stock practice'};
function payload(j){return JSON.stringify(j);}

test('A genuine exported v1 journal can be reviewed without modifying it',()=>{
 const j=closeTrade(openTrade({...EMPTY,watchlist:['AAPL','MSFT']},t),'manual-1',12000,'2026-10-10T00:00:00Z');
 const raw=payload(j);
 const result=inspectJournalBackup(raw);
 assert.deepEqual(result.journal,j);
 assert.equal(result.watchlistCount,2);
 assert.equal(result.tradeCount,1);
 assert.equal(result.openCount,0);
 assert.equal(result.closedCount,1);
 assert.equal(result.realizedCents,4000);
 assert.equal(raw,payload(j));
});
test('Invalid files are rejected before any restore could be offered',()=>{
 const bad=[
  'not-json',
  '{}',
  '[]',
  '',
  'x'.repeat(MAX_BACKUP_BYTES+1),
  payload({...EMPTY,secret:'accidental extra field'}),
  payload({...EMPTY,version:2}),
  payload({...EMPTY,watchlist:['AAPL','AAPL']}),
  payload({...EMPTY,trades:[{...t,unexpected:'do not ingest'}]}),
  payload({...EMPTY,trades:[{...t,id:''}]}),
  payload({...EMPTY,trades:[{...t,entryCents:1000000000000000000}]}),
  payload({...EMPTY,trades:[{...t,exitCents:10000}]}),
  payload({...EMPTY,trades:[{...t,closedAt:'2026-10-10T00:00:00Z'}]}),
  payload({...EMPTY,trades:[{...t,exitCents:9000,closedAt:'invalid'}]}),
  payload({...EMPTY,trades:[{...t,shares:1.5}]}),
  payload({...EMPTY,watchlist:['TSLA'],trades:[t,t]}),
  payload({...EMPTY,watchlist:[23]}),
 ];
 for(const item of bad){assert.throws(()=>inspectJournalBackup(item),`Expected rejection: ${item.slice(0,90)}`);}
});
test('Losses are retained, not hidden on restore',()=>{
 const j=closeTrade(openTrade(EMPTY,t),'manual-1',5000,'2026-10-11T00:00:00Z');
 const result=inspectJournalBackup(payload(j));
 assert.equal(result.realizedCents,-10000);
 assert.equal(result.closedCount,1);
 assert.equal(result.journal.trades[0].exitCents,5000);
});
test('Current browser records and broker data are outside validation function',()=>{
 const j=inspectJournalBackup(payload(EMPTY));
 assert.equal(j.tradeCount,0);
 assert.equal(j.watchlistCount,0);
 assert.deepEqual(j.journal,EMPTY);
});
