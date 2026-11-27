// Real production timing regression. Synthetic run objects; no network or dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateJob,workflowCrons} from './ops-monitor-lib.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const job=JSON.parse(read('config/ops/jobs.json')).jobs.find(j=>j.id==='kalshi-weather-shadow');
const crons=job.crons??workflowCrons(read('.github/workflows/'+job.workflow));
const run=(at,conclusion='success')=>({id:Date.parse(at),html_url:'https://github.com/ang87505-crypto/SportsEdge/actions/runs/1',
 event:'workflow_dispatch',status:'completed',conclusion,run_started_at:at,created_at:at,updated_at:at});
const morning=run('2026-11-26T09:27:00Z'),afternoon=run('2026-11-26T12:20:29Z');
const evaluate=(runs,state='active')=>evaluateJob(job,{workflowState:state,runs,crons,
 nowMs:Date.parse('2026-11-26T18:38:55Z'),activeSinceMs:Date.parse('2026-11-26T06:48:46Z')});
test('weather monitor follows the Vercel dispatch slots actually responsible for on-time freezes',()=>{
 const vercel=JSON.parse(read('vercel.json')).crons.filter(c=>/^\/api\/internal\/scheduler\/kalshi-weather-(same-day|day-ahead)$/.test(c.path));
 assert.equal(vercel.length,2);
 assert.deepEqual(crons,vercel.map(c=>c.schedule));
});
test('two successful Vercel dispatches before the GitHub backup times cover both weather slots',()=>{
 const result=evaluate([afternoon,morning]);
 assert.equal(result.status,'OK');assert.equal(result.slots7d.due,2);assert.equal(result.slots7d.missed,0);
});
test('a genuinely absent afternoon dispatch is still reported as missed',()=>{
 const result=evaluate([morning]);assert.equal(result.status,'MISSED_SLOT');assert.equal(result.slots7d.missed,1);
});
test('a failed afternoon dispatch remains a failure',()=>{
 assert.equal(evaluate([run('2026-11-26T12:20:29Z','failure'),morning]).status,'FAILING');
});
test('zero weather runs never report healthy',()=>assert.equal(evaluate([]).status,'PENDING_FIRST_RUN'));
test('disabled weather workflow remains disabled despite previous successes',()=>
 assert.equal(evaluate([afternoon,morning],'disabled_manually').status,'DISABLED'));
