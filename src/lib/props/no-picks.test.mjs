import test from 'node:test';
import assert from 'node:assert/strict';
import {whyNoPicks} from './no-picks.ts';
import {buildView} from './dashboard-view.ts';
import {makeRaw} from '../assistant/fixtures.mjs';

const NOW='2026-11-12T18:00:00.000Z';
const view=(opts={})=>buildView(makeRaw({nowIso:NOW,tonight:false,...opts}),'prizepicks');
const status=(o={})=>({mode:'ticks',capturesAvailable:true,lastSuccess:null,next:null,executions:[],noEntryReasons:[],missing:[],
 stages:{planned:0,completedJobs:0,recordedPicks:0,virtualEntries:0},
 budget:{daily:7,monthly:200,used24h:7,used30d:29,remaining24h:0,remaining30d:171,providerRemaining:476,providerFloor:60,
  nextRelease:{at:'2026-11-12T20:11:00.000Z',credits:7},countsProviderActuals:false},slates:[],...o});
const game=(state,o={})=>({event:'e'+state,matchup:'Pistons @ Wizards',tipoff:'2026-11-13T00:10:00Z',arm:'late',state,
 window:{from:'2026-11-12T21:10:00Z',to:'2026-11-12T23:35:00Z'},captures:[],...o});
const slate=(games,o={})=>({date:'2026-11-12',arm:'late',gamesExamined:4,selected:games.length,captured:0,linesObserved:0,qualifyingPicks:0,entries:0,games,...o});
const ctl={state:'RUNNING',reason:'ok'};

test('upcoming picks and owner pause come first',()=>{
 assert.equal(whyNoPicks({view:buildView(makeRaw({nowIso:'2026-11-09T19:00:00.000Z'}),'prizepicks'),status:status(),nowIso:'2026-11-09T19:00:00.000Z',control:ctl}).code,'HAS_PICKS');
 const p=whyNoPicks({view:view(),status:status(),nowIso:NOW,control:{state:'PAUSED',reason:'Owner pause'}});
 assert.equal(p.code,'PAUSED');assert.equal(p.detail,'Owner pause');
});

test('capture ticks: waiting for a window, budget refused, nothing posted, nothing qualified, failures, misses, no games',()=>{
 const w=whyNoPicks({view:view(),status:status({slates:[slate([game('WAITING_FOR_WINDOW')])]}),nowIso:NOW,control:ctl});
 assert.equal(w.code,'WAITING_FOR_WINDOW');assert.match(w.headline,/next opens .*Pistons @ Wizards, LATE/);
 assert.match(w.detail,/Only 0 of 7 credits are free right now; 7 credits free again/);
 assert.equal(whyNoPicks({view:view(),status:status({slates:[slate([game('BUDGET_REFUSED')])]}),nowIso:NOW,control:ctl}).code,'BUDGET_EXHAUSTED');
 assert.equal(whyNoPicks({view:view(),status:status({slates:[slate([game('CAPTURED')],{captured:1,linesObserved:0})]}),nowIso:NOW,control:ctl}).code,'NO_LINES_POSTED');
 const nq=whyNoPicks({view:view(),status:status({slates:[slate([game('CAPTURED')],{captured:1,linesObserved:42})],
  noEntryReasons:[{platform:'prizepicks',reason:'NO_QUALIFYING_PICKS',text:'No line met the pick rules, so there was nothing to combine.'}]}),nowIso:NOW,control:ctl});
 assert.equal(nq.code,'NO_QUALIFYING_LINES');assert.match(nq.headline,/42 lines were captured; none met/);
 assert.equal(whyNoPicks({view:view(),status:status({slates:[slate([game('FAILED')])]}),nowIso:NOW,control:ctl}).code,'CAPTURE_FAILED');
 assert.equal(whyNoPicks({view:view(),status:status({slates:[slate([game('MISSED')])]}),nowIso:NOW,control:ctl}).code,'WINDOWS_MISSED');
 assert.equal(whyNoPicks({view:view(),status:status({slates:[]}),nowIso:NOW,control:ctl}).code,'NO_GAMES_PLANNED');
});

test('legacy slots: refused by the cap, or completed with nothing qualifying; unreadable receipts say so',()=>{
 const legacy=o=>status({mode:'slots',executions:[{id:1,slot:'collect-2026-11-12T19',mode:'slot',trigger:null,startedAt:NOW,delayMinutes:0,status:'completed',gamesCaptured:null,entries:0,...o}]});
 assert.equal(whyNoPicks({view:view(),status:legacy({outcome:'BUDGET_EXHAUSTED',qualifyingPicks:null}),nowIso:NOW,control:ctl}).code,'BUDGET_EXHAUSTED');
 assert.equal(whyNoPicks({view:view(),status:legacy({outcome:'COMPLETED',qualifyingPicks:0}),nowIso:NOW,control:ctl}).code,'NO_QUALIFYING_LINES');
 assert.equal(whyNoPicks({view:view(),status:null,nowIso:NOW,control:ctl}).code,'UNKNOWN');
});
