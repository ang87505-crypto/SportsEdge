import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOneOrderCheck,parsePaperPreflight,explainPaperBlocker,
 explainPaperRequestFailure} from './alpaca-paper-ui-diagnostics.ts';

const state={oneShotReleaseReady:true,stage:{status:'not_authorized',gateHalted:true}};
const pre={status:'READ_ONLY_PREFLIGHT',symbol:'F',shares:1,limitCents:1250,
 checkedAt:'2026-10-15T14:01:00.000Z',marketOpen:false,sessionCloseAt:null,
 staging:'HALTED',blockers:['MARKET_CLOSED_OR_CLOCK_UNVERIFIED'],
 quote:null,brokerOrderSubmitted:false,ownerApproved:false,executionPermitted:false};

test('verified status requires the stage and release evidence together',()=>{
 assert.deepEqual(parseOneOrderCheck(state),state);
 assert.equal(parseOneOrderCheck({...state,stage:{...state.stage,gateHalted:'yes'}}),null);
 assert.equal(parseOneOrderCheck({oneShotReleaseReady:true}),null);
 assert.equal(parseOneOrderCheck({...state,stage:{status:'token:',gateHalted:true}}),null);
});
test('preflight rejects mismatches and missing fail-closed evidence',()=>{
 assert.deepEqual(parsePaperPreflight(pre,'F',1250),pre);
 assert.equal(parsePaperPreflight(pre,'AAPL',1250),null);
 assert.equal(parsePaperPreflight({...pre,brokerOrderSubmitted:true},'F',1250),null);
 assert.equal(parsePaperPreflight({...pre,checkedAt:'n/a'},'F',1250),null);
 assert.equal(parsePaperPreflight({...pre,blockers:['BAD DATA']},'F',1250),null);
 assert.equal(parsePaperPreflight({...pre,quote:{bidCents:1300,askCents:1100,observedAt:pre.checkedAt}},'F',1250),null);
});
test('diagnostics explain 401, staging outages, stale quotes without echoing secrets',()=>{
 assert.match(explainPaperRequestFailure(401,{},'release'),/Unlock/);
 assert.match(explainPaperRequestFailure(503,{status:'staging_unavailable'},'release'),/staging/);
 assert.match(explainPaperRequestFailure(503,{reason:'BROKER_UNAVAILABLE'},'preflight'),/Alpaca/);
 assert.match(explainPaperBlocker('QUOTE_MISSING_OR_STALE'),/IEX/);
 assert.doesNotMatch(explainPaperRequestFailure(503,{reason:'secret-token-123'},'preflight'),/secret-token/);
 assert.doesNotMatch(explainPaperBlocker('secret-token-123'),/secret-token/);
});
