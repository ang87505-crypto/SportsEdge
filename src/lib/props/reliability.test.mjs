// Props automation reliability: no-entry reasons, slot status, midnight/DST boundaries and backup windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {explainNoEntries,buildEntries} from './rules.ts';
import {slotStatus} from './slot-status.ts';
import {scheduledInstant,slotKey,PROPS_SCHEDULE} from './schedule.ts';
import {etMidnightUtc,COLLECT_MAX_START_DELAY_S} from '../server/props-cycle.ts';
import {SCHEDULER_SLOTS} from '../server/scheduler-kickoff.ts';

const NOW='2026-11-10T02:00:30.000Z';
const pick=(id,event,player,lockAt='2026-11-10T03:30:00.000Z',p=0.6,platform='prizepicks')=>
 ({pickId:id,platform,eventId:event,playerKey:player,teamAbbr:'',probability:p,lockAt});
const opts={platform:'prizepicks',picksPerEntry:2,maxEntries:2,nowIso:NOW,lockBufferMs:10*60_000};

test('no-entry reason: a single game cannot make a two-game entry, and nothing is forced', () => {
 // The Nov 9 shape: the 410-minute-late collect priced one game only.
 const one=[pick(1,'g1','a'),pick(2,'g1','b'),pick(3,'g1','c')];
 assert.equal(buildEntries(one,opts).length,0);
 assert.equal(explainNoEntries(one,opts).reason,'TOO_FEW_DISTINCT_GAMES');
 assert.equal(explainNoEntries(one,opts).distinctGames,1);
 assert.equal(explainNoEntries([],opts).reason,'NO_QUALIFYING_PICKS');
 assert.equal(explainNoEntries([pick(1,'g1','a'),pick(2,'g2','b')],{...opts,maxEntries:0}).reason,'DAILY_ENTRY_LIMIT_REACHED');
 const late=[pick(1,'g1','a','2026-11-10T02:05:00.000Z'),pick(2,'g2','b','2026-11-10T02:05:00.000Z')];
 assert.equal(explainNoEntries(late,opts).reason,'PICKS_TOO_CLOSE_TO_LOCK');
 assert.equal(explainNoEntries([pick(1,'g1','a'),pick(2,'g2','a')],opts).reason,'TOO_FEW_DISTINCT_PLAYERS');
 assert.equal(explainNoEntries([pick(1,'g1','a'),pick(2,'g2','b')],opts),null); // an entry is possible: no reason
 assert.equal(explainNoEntries([pick(1,'g1','a',undefined,0.6,'pick6'),pick(2,'g2','b',undefined,0.6,'pick6')],opts).reason,'NO_QUALIFYING_PICKS');
});

test('slot attribution: late and post-midnight arrivals keep their own slot key', () => {
 // GitHub started the 19:10 collect at 02:00 next day: still the Nov 9 slot (410 minutes late).
 assert.equal(slotKey('collect',scheduledInstant('10 19 * * *','2026-11-10T02:00:01Z')),'collect-2026-11-09T19');
 // The 22:10 slot just after midnight UTC, and at 23:59 the same day.
 assert.equal(slotKey('collect',scheduledInstant('10 22 * * *','2026-11-11T00:20:00Z')),'collect-2026-11-10T22');
 assert.equal(slotKey('collect',scheduledInstant('10 22 * * *','2026-11-10T23:59:00Z')),'collect-2026-11-10T22');
 // A backup an hour later lands on the same key as the on-time run, so the ledger refuses the second start.
 assert.equal(slotKey('settle',scheduledInstant('20 9 * * *','2026-11-10T10:40:00Z')),slotKey('settle',scheduledInstant('20 9 * * *','2026-11-10T09:21:00Z')));
});

test('daylight saving: the entry day starts at New York midnight on both sides of each change', () => {
 // DST ends 2026-11-01 06:00 UTC; next begins 2027-03-14 07:00 UTC.
 assert.equal(etMidnightUtc('2026-10-31T23:00:00Z'),'2026-10-31T04:00:00.000Z');
 assert.equal(etMidnightUtc('2026-11-01T05:30:00Z'),'2026-11-01T04:00:00.000Z'); // 01:30 EDT, before the change
 assert.equal(etMidnightUtc('2026-11-01T06:30:00Z'),'2026-11-01T04:00:00.000Z'); // 01:30 EST, after it
 assert.equal(etMidnightUtc('2026-11-02T04:30:00Z'),'2026-11-01T04:00:00.000Z'); // 23:30 EST, still Nov 1
 assert.equal(etMidnightUtc('2026-11-02T05:00:00Z'),'2026-11-02T05:00:00.000Z');
 assert.equal(etMidnightUtc('2027-03-14T06:59:00Z'),'2027-03-14T05:00:00.000Z');
 assert.equal(etMidnightUtc('2027-03-14T08:00:00Z'),'2027-03-14T05:00:00.000Z');
 // Slots are fixed in UTC, so their keys never shift with DST.
 assert.equal(slotKey('collect',scheduledInstant('10 19 * * *','2026-11-01T19:30:00Z')),'collect-2026-11-01T19');
 assert.equal(slotKey('collect',scheduledInstant('10 19 * * *','2027-03-14T19:30:00Z')),'collect-2027-03-14T19');
});

test('every Vercel backup lands inside the late-start window of the slot it stands in for', () => {
 for(const [name,slot] of Object.entries(SCHEDULER_SLOTS)){
  if(!slot.props)continue;
  const s=PROPS_SCHEDULE.find(x=>x.cron===slot.inputs.cron&&x.kind===slot.inputs.kind);
  assert.ok(s,name);
  const earliest=(slot.hourUtc*60-(s.hour*60+s.minute)),latest=earliest+59;  // Vercel Hobby fires within the hour
  assert.ok(earliest>0,name+' must fire after its slot');
  if(s.kind==='collect')assert.ok(latest*60<=COLLECT_MAX_START_DELAY_S,`${name}: up to ${latest} min late`);
 }
});

test('slot status separates scheduled, started, completed, picks, entries and settlement', () => {
 const runs=[
  {kind:'collect',slot_key:'collect-2026-11-09T22',status:'completed',outcome:'BUDGET_EXHAUSTED',started_at:'2026-11-10T04:04:39Z',
   finished_at:'2026-11-10T04:04:41Z',start_delay_seconds:21269,summary:{trigger:'github-schedule',reason:'budget_exhausted_before_start'}},
  {kind:'collect',slot_key:'collect-2026-11-09T19',status:'completed',outcome:'COMPLETED',started_at:'2026-11-10T02:00:07Z',
   finished_at:'2026-11-10T02:00:14Z',start_delay_seconds:24607,summary:{receipt:{observations:36,predictions:70,picks:36},
    entries:{prizepicks:{room:2,eligiblePicks:4,entries:[],noEntryReason:'TOO_FEW_DISTINCT_GAMES'},pick6:{room:2,eligiblePicks:1,entries:[],noEntryReason:'TOO_FEW_DISTINCT_GAMES'}}}},
  {kind:'settle',slot_key:'settle-2026-11-09T09',status:'completed',outcome:'COMPLETED',started_at:'2026-11-09T19:53:56Z',
   finished_at:'2026-11-09T19:54:10Z',start_delay_seconds:38040,summary:{settlement:{open:3,settled:3}}}];
 const rows=slotStatus(runs,'2026-11-10T05:00:00Z',1);
 const c19=rows.find(r=>r.slot==='collect-2026-11-09T19');
 assert.equal(c19.state,'COMPLETED');assert.equal(c19.startDelayMinutes,410);
 // Legacy receipt (Nov 9): `picks` is the decision count. Qualifying picks cannot be established from it.
 assert.equal(c19.decisions,36);assert.equal(c19.qualifyingPicks,null);assert.equal(c19.entriesCreated,0);
 assert.equal(c19.countsSource,'receipt');
 assert.deepEqual(c19.noEntryReasons.map(r=>r.reason),['TOO_FEW_DISTINCT_GAMES','TOO_FEW_DISTINCT_GAMES']);
 assert.equal(rows.find(r=>r.slot==='collect-2026-11-09T22').state,'SKIPPED');
 assert.equal(rows.find(r=>r.slot==='settle-2026-11-09T09').entriesSettled,3);
 assert.equal(rows.find(r=>r.slot==='settle-2026-11-09T15').state,'NO_RUN_RECORDED');
 const future=rows.find(r=>r.slot==='collect-2026-11-10T19');
 assert.equal(future.state,'PLANNED');assert.equal(future.startedAt,null);assert.equal(future.outcome,null); // a plan is never a run
});

test('regression: 36 decisions, 10 qualifying picks and 0 entries are three different numbers', () => {
 // The real collect-2026-11-09T19 receipt, unchanged (immutable), plus the counts read from its saved rows.
 const run={id:10,kind:'collect',slot_key:'collect-2026-11-09T19',status:'completed',outcome:'COMPLETED',started_at:'2026-11-10T02:00:07Z',
  finished_at:'2026-11-10T02:00:14Z',start_delay_seconds:24607,summary:{receipt:{observations:36,predictions:70,picks:36},
   predictions:{scored:34,recorded:10},entries:{prizepicks:{room:3,eligiblePicks:18,entries:[]},pick6:{room:3,eligiblePicks:6,entries:[]}}}};
 const counts={'10':{decisions:36,qualifyingPicks:10,entries:0}};
 const row=slotStatus([run],'2026-11-10T05:00:00Z',1,counts).find(r=>r.slot==='collect-2026-11-09T19');
 assert.deepEqual([row.decisions,row.qualifyingPicks,row.entriesCreated,row.countsSource],[36,10,0,'ledger']);
 assert.notEqual(row.qualifyingPicks,row.decisions);
 // Without the row counts, the legacy receipt cannot establish qualifying picks: unknown, never 36 and never a guess.
 const legacy=slotStatus([run],'2026-11-10T05:00:00Z',1,null).find(r=>r.slot==='collect-2026-11-09T19');
 assert.deepEqual([legacy.decisions,legacy.qualifyingPicks,legacy.entriesCreated],[36,null,0]);
 // A new receipt carries all three explicitly.
 const fresh={...run,id:11,slot_key:'collect-2026-11-09T22',summary:{receipt:{observations:36,predictions:70,picks:36,decisions:36,
  qualifyingPicks:10,skippedDecisions:26,entriesCreated:0}}};
 const r2=slotStatus([fresh],'2026-11-10T05:00:00Z',1,null).find(r=>r.slot==='collect-2026-11-09T22');
 assert.deepEqual([r2.decisions,r2.qualifyingPicks,r2.entriesCreated,r2.countsSource],[36,10,0,'receipt']);
});
