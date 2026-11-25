/**
 * SportsEdge safe-expansion contract: pure plan validation and an optional
 * "planning-only" diff check. Does not import production modules, read secrets,
 * access the network, modify records, or trigger any workflow.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const PLAN_URL=new URL('../research/planning/sportsedge-safe-expansion-v1.json',import.meta.url);
export const PLANNING_FILES=Object.freeze([
 '.github/workflows/sportsedge-expansion-plan-verify.yml',
 'docs/SPORTSEDGE_SAFE_EXPANSION_ROADMAP_2026_11_13.md',
 'docs/SPORTSEDGE_CLAUDE_HANDOFF_2026_11_13.md',
 'research/planning/sportsedge-safe-expansion-v1.json',
 'scripts/sportsedge-expansion-guard.mjs',
 'scripts/sportsedge-expansion-guard.test.mjs'
]);
const IS_ID=/^[a-z][a-z0-9-]*$/;
const ARR=Array.isArray;
function fail(msg){throw Error('EXPANSION_PLAN_INVALID: '+msg);}
export const loadPlan=()=>JSON.parse(readFileSync(PLAN_URL,'utf8'));
export function validatePlan(p){
 if(!p||p.schema!=='sportsedge-safe-expansion-v1')fail('schema');
 if(p.developmentMode!=='isolated-draft-no-merge-no-deploy-no-activation')fail('unsafe development mode');
 if(!ARR(p.streams)||p.streams.length<12)fail('missing workstreams');
 if(!ARR(p.defaultSafetyGates)||p.defaultSafetyGates.length<6)fail('missing safeguards');
 if(!ARR(p.protectedFiles)||new Set(p.protectedFiles).size!==p.protectedFiles.length||
    p.protectedFiles.some(x=>typeof x!=='string'||!x.trim()))fail('protected file set');
 const ids=new Set();
 for(const s of p.streams){
  if(!s||typeof s.id!=='string'||!IS_ID.test(s.id)||ids.has(s.id))fail('duplicate/invalid stream id');
  ids.add(s.id);
  if(!ARR(s.dependsOn)||!ARR(s.sourcePRs)||!ARR(s.acceptance)||s.acceptance.length<2||
   s.acceptance.some(x=>typeof x!=='string'||!x.trim())||
   typeof s.title!=='string'||!s.title||
   typeof s.deliverable!=='string'||!s.deliverable||
   typeof s.ownerGate!=='boolean')fail('incomplete stream '+s.id);
  if(s.sourcePRs.some(x=>!Number.isSafeInteger(x)||x<=0))fail('invalid PR');
  if(s.status==='blocked-permissions'&&!s.ownerGate)fail('blocked stream without owner gate');
  if(s.status.startsWith('draft')&&!s.sourcePRs.length)fail('draft without PR');
 }
 const byId=new Map(p.streams.map(s=>[s.id,s]));
 const visited=new Set(),stack=new Set();
 function check(id){
  if(stack.has(id))fail('dependency cycle at '+id);
  if(visited.has(id))return;
  const s=byId.get(id);if(!s)fail('missing dependency '+id);
  stack.add(id);
  if(new Set(s.dependsOn).size!==s.dependsOn.length)fail('duplicate dependencies '+id);
  for(const dep of s.dependsOn)check(dep);
  stack.delete(id);visited.add(id);
 }
 for(const id of ids)check(id);
 if(!ARR(p.knownCollisions)||p.knownCollisions.length<3)fail('missing collision review');
 for(const c of p.knownCollisions){
  if(!ARR(c.prs)||c.prs.length<2||!ARR(c.paths)||!c.paths.length||
   !c.resolution||c.paths.some(x=>typeof x!=='string'||!x))fail('bad collision');
 }
 if(!ARR(p.excluded)||!p.excluded.some(x=>/Real-money/.test(x)))fail('real-money boundary');
 return {streams:ids.size,dependencies:[...byId.values()].reduce((n,s)=>n+s.dependsOn.length,0),collisionGroups:p.knownCollisions.length};
}
/** Reject any path outside the known planning-only footprint. */
export function verifyPlanningDiff(paths,allowed=PLANNING_FILES){
 if(!ARR(paths)||paths.length===0)fail('empty diff');
 const allow=new Set(allowed);
 for(const path of paths){
  if(typeof path!=='string'||!allow.has(path))fail('non-planning change: '+String(path));
 }
 return {checkedFiles:paths.length,planningOnly:true};
}
function main(){
 const plan=loadPlan(),summary=validatePlan(plan);
 if(process.argv.includes('--diff')){
  const changed=execFileSync('git',['diff','--name-only','--diff-filter=ACMRT','origin/main...HEAD'],
   {encoding:'utf8',maxBuffer:2_000_000}).trim().split('\n').filter(Boolean);
  Object.assign(summary,verifyPlanningDiff(changed));
 }
 console.log(JSON.stringify({status:'PASS',...summary}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{main();}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
}
