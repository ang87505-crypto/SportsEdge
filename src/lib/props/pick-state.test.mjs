import test from 'node:test';
import assert from 'node:assert/strict';
import {lineState,entryState,LINE_STATE,ENTRY_STATE} from './pick-state.ts';

const L=(o={})=>({decision:'recorded',side:'less',locked:false,result:null,correct:null,...o});
test('every line has one unmistakable state, from receipts only',()=>{
 assert.equal(lineState(L()),'UPCOMING');
 assert.equal(lineState(L({locked:true})),'LOCKED');
 assert.equal(lineState(L({locked:true,result:{outcome:'less',actual:6},correct:true})),'WON');
 assert.equal(lineState(L({locked:true,result:{outcome:'more',actual:19},correct:false})),'LOST');
 for(const o of ['void_dnp','void_postponed','tie'])assert.equal(lineState(L({locked:true,result:{outcome:o,actual:null},correct:null})),'VOID');
 assert.equal(lineState(L({decision:'skipped',side:null})),'SKIPPED');
 assert.equal(lineState(L({decision:'skipped',side:null,locked:true,result:{outcome:'more',actual:3}})),'NOT_PICKED_GRADED');
 const labels=Object.values(LINE_STATE).map(x=>x.label);
 assert.ok(['Upcoming','Locked · awaiting result','Hit','Miss','Void'].every(l=>labels.includes(l)));
 assert.notEqual(LINE_STATE.WON.tone,LINE_STATE.LOST.tone);assert.notEqual(LINE_STATE.UPCOMING.tone,LINE_STATE.LOCKED.tone);
});
test('entries: open before lock, awaiting results after lock, then settled states; unknown payout is never shown as won or lost',()=>{
 assert.equal(entryState({settlement:null,legs:[L(),L()]}),'OPEN');
 assert.equal(entryState({settlement:null,legs:[L({locked:true}),L()]}),'AWAITING_RESULTS');
 assert.equal(entryState({settlement:{outcome:'won',profitCents:1000},legs:[]}),'WON');
 assert.equal(entryState({settlement:{outcome:'lost',profitCents:-500},legs:[]}),'LOST');
 assert.equal(entryState({settlement:{outcome:'refund',profitCents:0},legs:[]}),'REFUNDED');
 assert.equal(entryState({settlement:{outcome:'payout_unknown',profitCents:null},legs:[]}),'SETTLED_PAYOUT_UNKNOWN');
 assert.match(ENTRY_STATE.SETTLED_PAYOUT_UNKNOWN.label,/payout unknown/);
});
