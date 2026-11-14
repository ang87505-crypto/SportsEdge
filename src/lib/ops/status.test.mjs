import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpsStatus,opsSummaryText} from './status.ts';
import {loadOpsStatus,resetOpsStatusCache} from '../server/ops-status-load.ts';

const NOW='2026-11-10T03:00:00.000Z';
const run=(id,conclusion='success')=>({id,url:'https://github.com/ang87505-crypto/SportsEdge/actions/runs/'+id,event:'schedule',status:'completed',conclusion,startedAt:'2026-11-10T02:40:00.000Z',finishedAt:'2026-11-10T02:45:00.000Z'});
const job=(over={})=>({id:'research-collect',label:'Strategy research: nightly collection',area:'research',required:true,status:'OK',detail:'ok',
 historyUrl:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/research-collect.yml',lastRun:run(1),lastSuccess:run(1),lastFailure:null,running:null,
 slots7d:{due:1,missed:0,lastMissedAt:null},nextPlanned:['2026-11-11T02:17:00.000Z'],note:null,...over});
const status=(over={})=>({schemaVersion:'ops-status-v1',generatedAt:'2026-11-10T02:50:00.000Z',monitorRun:null,overall:{state:'OK',attention:[]},
 jobs:[job()],blockers:[],site:{url:'https://x',checkedAt:NOW,ok:true,checks:[{name:'Overview page',ok:true,ms:10,detail:null}]},evidence:{},credentials:[],...over});

test('parses a valid status and refuses malformed, future-dated or foreign-link files', () => {
  assert.ok(parseOpsStatus(status(), NOW));
  assert.equal(parseOpsStatus({...status(), generatedAt: '2026-11-11T00:00:00Z'}, NOW), null);
  assert.equal(parseOpsStatus({...status(), schemaVersion: 'x'}, NOW), null);
  assert.equal(parseOpsStatus(status({jobs: [job({historyUrl: 'https://evil.example/x'})]}), NOW), null);
  assert.equal(parseOpsStatus(status({jobs: [job({lastSuccess: {...run(1), url: 'javascript:alert(1)'}})]}), NOW), null);
});

test('chat summary separates real runs from planned times', () => {
  const text = opsSummaryText({status: status({jobs: [job({status: 'PENDING_FIRST_RUN', lastRun: null, lastSuccess: null})]}), mode: 'live', checkedAt: NOW, monitorStale: false});
  assert.match(text, /no successful run yet/);
  assert.match(text, /next planned .*\(planned, not yet run\)/);
  assert.doesNotMatch(text, /last success/);
  assert.match(opsSummaryText({status: null, mode: 'unavailable', checkedAt: NOW, monitorStale: false}), /not evidence of a run/);
});

test('loader: live file, unavailable feed and stale monitor', async () => {
  resetOpsStatusCache();
  const live = await loadOpsStatus(NOW, async () => new Response(JSON.stringify(status())));
  assert.equal(live.mode, 'live'); assert.equal(live.monitorStale, false);
  resetOpsStatusCache();
  const down = await loadOpsStatus(NOW, async () => { throw new Error('offline'); });
  assert.equal(down.mode, 'unavailable'); assert.equal(down.status, null);
  resetOpsStatusCache();
  const old = await loadOpsStatus('2026-11-10T20:00:00.000Z', async () => new Response(JSON.stringify(status())));
  assert.equal(old.monitorStale, true);
});

test('chat summary reports which commit production serves only when the monitor checked it',async()=>{
 const {opsSummaryText}=await import('./status.ts');
 const status={schemaVersion:'ops-status-v1',generatedAt:'2026-11-12T00:00:00Z',monitorRun:null,overall:{state:'OK',attention:[]},jobs:[],blockers:[],
  site:{url:'x',checkedAt:'2026-11-12T00:00:00Z',ok:true,checks:[]},evidence:{},credentials:[]};
 const view={status,mode:'live',checkedAt:'2026-11-12T00:00:00Z',monitorStale:false};
 assert.doesNotMatch(opsSummaryText(view),/Deployment:/);
 status.site.deployment={state:'UNKNOWN',detail:'Deployment identity or main head unavailable.',deployedSha:null,deployedRef:null,mainSha:null};
 assert.doesNotMatch(opsSummaryText(view),/Deployment:/);
 status.site.deployment={state:'BEHIND_MAIN',detail:'Production serves aaaaaaa; main is bbbbbbb (90 min old).',deployedSha:'a'.repeat(40),deployedRef:'main',mainSha:'b'.repeat(40)};
 assert.match(opsSummaryText(view),/Deployment: Production serves aaaaaaa; main is bbbbbbb/);
});

test('public NOAA archive is not mistaken for Kalshi quotes, prices or trade outcomes',()=>{
 const published={source:'PUBLIC_NOAA_ONLY',forecastState:'RECORDED',scorecardState:'AWAITING_FIRST_ARCHIVE',
  latestTargetDate:'2026-11-11',forecastCapturedAt:'2026-11-10T20:20:00Z',lastGradedDate:null};
 const s=status({evidence:{publicWeather:published}});
 assert.ok(parseOpsStatus(s,NOW));
 const text=opsSummaryText({status:s,mode:'live',checkedAt:NOW,monitorStale:false});
 assert.match(text,/Independent NOAA weather memory: archived for 2026-11-11/);
 assert.match(text,/not Kalshi quotes or a market edge/);
 assert.doesNotMatch(text,/Kalshi profits|trade filled|we won 60/i);
 const missing={...published,forecastState:'AWAITING_FIRST_ARCHIVE',scorecardState:'ARCHIVE_UNAVAILABLE',
  latestTargetDate:null,forecastCapturedAt:null};
 assert.ok(parseOpsStatus(status({evidence:{publicWeather:missing}}),NOW));
 const line=opsSummaryText({status:status({evidence:{publicWeather:missing}}),mode:'live',checkedAt:NOW,monitorStale:false});
 assert.match(line,/no recent verified archive found/);
 assert.doesNotMatch(line,/zero forecast probabilities|no opportunities available/i);
});
test('invalid or foreign NOAA evidence state is refused, legacy status remains supported',()=>{
 assert.ok(parseOpsStatus(status(),NOW));
 const base={source:'PUBLIC_NOAA_ONLY',forecastState:'RECORDED',scorecardState:'RECORDED',
  latestTargetDate:'2026-11-11',forecastCapturedAt:'2026-11-10T20:20:00Z',lastGradedDate:'2026-11-10'};
 for(const change of [
  {source:'KALSHI_EXCHANGE'}, {forecastState:'PROFITABLE'}, {scorecardState:'KALSHI_WIN'},
  {latestTargetDate:'not a date'}, {forecastCapturedAt:'invalid clock'},
  {lastGradedDate:'tomorrow'}
 ]){
  assert.equal(parseOpsStatus(status({evidence:{publicWeather:{...base,...change}}}),NOW),null);
 }
});
