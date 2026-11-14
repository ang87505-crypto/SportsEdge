import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlan,validatePlan,verifyPlanningDiff,PLANNING_FILES} from './sportsedge-expansion-guard.mjs';
const clone=x=>structuredClone(x);
test('the expansion plan validates and includes every research domain',()=>{
 const p=loadPlan(),s=validatePlan(p);
 assert.ok(s.streams>=15);
 assert.ok(s.collisionGroups>=3);
 assert.ok(s.dependencies>=8);
 for(const area of ['sports','stocks','kalshi','assistant','research','platform'])
  assert.ok(p.streams.some(x=>x.area===area),'missing '+area);
});
test('known PR collisions and stacked research dependencies are present',()=>{
 const p=loadPlan(),prSets=p.knownCollisions.map(c=>c.prs.join(','));
 assert.ok(prSets.includes('168,174'));
 assert.ok(prSets.includes('166,167'));
 assert.ok(p.streams.find(x=>x.id==='learning-engine').sourcePRs.includes(167));
 assert.ok(p.protectedFiles.includes('src/lib/stocks/paper-auto-release.ts'));
 assert.ok(p.protectedFiles.includes('src/lib/props/schedule.ts'));
});
test('approved footprint contains planning files only',()=>{
 assert.equal(verifyPlanningDiff(PLANNING_FILES).planningOnly,true);
 for(const candidate of [
  'src/lib/stocks/paper-auto-release.ts',
  'src/lib/props/schedule.ts',
  '.github/workflows/paper-auto-worker.yml',
  'src/app/page.tsx',
  'database/props/props_lab_v1.sql',
  'vercel.json',
  'research-data/independent-sports/nfl/snapshots/2026-11-13.json'
 ])assert.throws(()=>verifyPlanningDiff([...PLANNING_FILES,candidate]),/non-planning change/);
 assert.throws(()=>verifyPlanningDiff([]),/empty diff/);
});
test('rejects dependency cycles and missing dependencies',()=>{
 const p=loadPlan();
 const cyclic=clone(p);
 cyclic.streams.find(x=>x.id==='safety').dependsOn=['release'];
 assert.throws(()=>validatePlan(cyclic),/dependency cycle/);
 const missing=clone(p);
 missing.streams.find(x=>x.id==='safety').dependsOn=['unknown-feature'];
 assert.throws(()=>validatePlan(missing),/missing dependency/);
});
test('fail closed on owner approval or safety contract regressions',()=>{
 const p=loadPlan(),blocked=clone(p);
 blocked.streams.find(x=>x.id==='prediction-markets').ownerGate=false;
 assert.throws(()=>validatePlan(blocked),/owner gate/);
 const duplicate=clone(p);duplicate.streams.push(clone(duplicate.streams[0]));
 assert.throws(()=>validatePlan(duplicate),/duplicate/);
 const mode=clone(p);mode.developmentMode='auto-merge';
 assert.throws(()=>validatePlan(mode),/unsafe development mode/);
});
