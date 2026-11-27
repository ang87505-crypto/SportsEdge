// SYNTHETIC aggregate receipts. No provider, broker, database or owner session.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makePropsResearchEvidence,verifyPropsResearchEvidence,propsResearchResult,propsResearchFilename,PROPS_RESEARCH_DIRECTORY,PROPS_RESEARCH_MAX_AGE_MS} from './props-research.ts';
import {nextStatus} from './evaluate.ts';
import {MODEL_VERSION} from '../../props/contract.ts';

const ROOT=new URL('../../../../',import.meta.url),AT='2026-11-26T20:00:00.000Z',SHA='a'.repeat(40);
const seed=()=>JSON.parse(readFileSync(new URL('research/engine/registry.json',ROOT),'utf8'));
const spec=JSON.parse(readFileSync(new URL('src/data/props/challenger_gap_shrink_v1.json',ROOT),'utf8'));
function snapshot(n=12){return {asOf:AT,activeVersion:MODEL_VERSION,rankings:{privateSyntheticValue:'MUST_NOT_BE_ARCHIVED'},
 challengers:{[spec.version]:{version:spec.version,protocolId:spec.protocolId,forwardStartsAt:spec.forwardStartsAt,
 baseline:{n,brier:n?0.25:null,logLoss:n?0.69:null},candidate:{n,brier:n?0.24:null,logLoss:n?0.68:null},
 progress:{dates:n?3:0,games:n?5:0,pending:2,voided:0,preRegistration:7,invalid:0,missingMean:0},interval:null,
 status:'collecting',promotionEnabled:false,profitabilityDemonstrated:false}}};}
const record=(s=snapshot(),id='100-1')=>makePropsResearchEvidence(s,id,SHA);

test('only known aggregate evidence and its provenance are archived',()=>{
 const r=record();assert.deepEqual(verifyPropsResearchEvidence(r),r);
 assert.ok(!JSON.stringify(r).includes('MUST_NOT_BE_ARCHIVED'));
 assert.equal(r.asOf,AT);assert.equal(r.gap.baseline.n,12);assert.equal(r.activeModel,MODEL_VERSION);
 assert.match(propsResearchFilename(r),/^20261126T200000000Z-100-1\.json$/);
});
test('a changed protocol, baseline, sample or digest is rejected',()=>{
 const r=record();
 for(const change of [x=>x.gap.baseline.n++,x=>x.protocolSha256='b'.repeat(64),x=>x.activeModel='other',x=>x.sha256='b'.repeat(64)]){
  const changed=structuredClone(r);change(changed);assert.throws(()=>verifyPropsResearchEvidence(changed),/PROPS_RESEARCH_/);
 }
 const s=snapshot();s.challengers[spec.version].forwardStartsAt='2026-11-01T00:00:00Z';
 assert.throws(()=>record(s),/INVALID_EVIDENCE/);
});
test('malformed and contradictory statistics never become progress',()=>{
 for(const change of [g=>g.baseline.n=-1,g=>g.candidate.n=13,g=>g.progress.games=13,g=>g.progress.dates=1.5,
  g=>g.baseline.brier=Infinity,g=>g.interval={lower95:.1,upper95:-.1},g=>g.promotionEnabled=true,g=>g.profitabilityDemonstrated=true]){
  const s=snapshot();change(s.challengers[spec.version]);assert.throws(()=>record(s),/INVALID_EVIDENCE/);
 }
 const r=record(snapshot(0));assert.equal(r.gap.baseline.brier,null);assert.equal(propsResearchResult(r,AT).result.observations,0);
 assert.throws(()=>makePropsResearchEvidence(snapshot(),'../../escape',SHA),/INVALID_EVIDENCE/);
});
test('stale and future receipts cannot feed a current evaluation',()=>{
 const r=record();
 assert.equal(propsResearchResult(r,new Date(Date.parse(AT)+PROPS_RESEARCH_MAX_AGE_MS).toISOString()).result.observations,12);
 assert.throws(()=>propsResearchResult(r,new Date(Date.parse(AT)+PROPS_RESEARCH_MAX_AGE_MS+1).toISOString()),/STALE_EVIDENCE/);
 assert.throws(()=>propsResearchResult(r,new Date(Date.parse(AT)-1).toISOString()),/FUTURE_EVIDENCE/);
});
test('the scorer label cannot waive missing decision counts or the registered family rule',()=>{
 const s=snapshot(600),g=s.challengers[spec.version];g.progress.dates=20;g.progress.games=60;
 g.status='ready_for_review';g.interval={lower95:-.02,upper95:-.01};
 const x=propsResearchResult(record(s),AT),e=seed().experiments.find(e=>e.id===spec.version);
 assert.equal(x.result.disposition,'NO_CLEAR_EFFECT');assert.equal(x.result.decisions,undefined);
 assert.equal(nextStatus(e,x.result).to,'INSUFFICIENT_DATA');
 assert.match(x.result.reason,/no review-ready claim is inferred/);
});

function setup(){const dir=mkdtempSync(join(tmpdir(),'props-evidence-')),data=join(dir,'data');mkdirSync(data);return {dir,data};}
function publish(x,s=snapshot(),id='100-1'){
 const path=join(x.dir,'snapshot.json');writeFileSync(path,JSON.stringify(s));
 return execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/props-research-archive.ts',
  '--snapshot',path,'--data',x.data,'--run-id',id,'--source-commit',SHA,'--now',AT],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
function run(x,name,registry=seed(),now=AT){
 const regFile=join(x.dir,name+'-seed.json'),out=join(x.dir,name);writeFileSync(regFile,JSON.stringify(registry));
 const processResult=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine.ts',
  '--registry',regFile,'--out',out,'--now',now,'--props-research',x.data],{cwd:ROOT,encoding:'utf8'});
 return {process:processResult,report:JSON.parse(readFileSync(join(out,'report.json'),'utf8')),registry:JSON.parse(readFileSync(join(out,'registry.json'),'utf8'))};
}
test('publication is idempotent and a run cannot be rewritten or retimed',()=>{
 const x=setup();assert.equal(JSON.parse(publish(x)).alreadyPublished,false);
 const dir=join(x.data,PROPS_RESEARCH_DIRECTORY),files=readdirSync(dir),before=readFileSync(join(dir,files[0]),'utf8');
 assert.equal(JSON.parse(publish(x)).alreadyPublished,true);
 assert.equal(readFileSync(join(dir,files[0]),'utf8'),before);
 const changed=snapshot();changed.challengers[spec.version].candidate.brier=.23;
 assert.throws(()=>publish(x,changed),/IMMUTABLE_RUN/);
 const retimed=snapshot();retimed.asOf='2026-11-26T19:59:00.000Z';assert.throws(()=>publish(x,retimed),/IMMUTABLE_RUN/);
 assert.deepEqual(readdirSync(dir),files);
});
test('engine consumes the archive once, keeps unchanged results idempotent and leaves terminal findings alone',()=>{
 const x=setup();publish(x);
 const a=run(x,'a');assert.equal(a.process.status,0,a.process.stderr);assert.equal(a.report.domains.propsResearch.state,'CONNECTED');
 const e=a.registry.experiments.find(e=>e.id===spec.version);assert.equal(e.status,'INSUFFICIENT_DATA');
 assert.ok(!a.report.evidence.experiments.ownerSuppliedOnly.some(e=>e.id===spec.version));
 const b=run(x,'b',a.registry);assert.equal(b.process.status,0,b.process.stderr);
 assert.equal(b.registry.experiments.find(e=>e.id===spec.version).history.length,e.history.length);
 for(const status of ['FAILED','REJECTED']){
  const reg=seed();reg.experiments.find(e=>e.id===spec.version).status=status;
  const terminal=run(x,status,reg);assert.equal(terminal.process.status,0,terminal.process.stderr);
  assert.equal(terminal.registry.experiments.find(e=>e.id===spec.version).status,status);
 }
});
test('first receipt is pending; invalid newest evidence fails without changing the registry',()=>{
 const x=setup(),pending=run(x,'pending');assert.equal(pending.process.status,0,pending.process.stderr);
 assert.equal(pending.report.domains.propsResearch.state,'PENDING_FIRST_RECEIPT');
 publish(x);const reg=seed(),expired=run(x,'expired',reg,'2026-11-29T20:00:00Z');
 assert.notEqual(expired.process.status,0);assert.equal(expired.report.failure,'PROPS_RESEARCH_STALE_EVIDENCE');assert.deepEqual(expired.registry,reg);
 const dir=join(x.data,PROPS_RESEARCH_DIRECTORY),file=readdirSync(dir)[0];
 const bad=JSON.parse(readFileSync(join(dir,file),'utf8'));bad.gap.candidate.brier=.1;writeFileSync(join(dir,file),JSON.stringify(bad));
 const tampered=run(x,'tampered',reg);assert.notEqual(tampered.process.status,0);assert.deepEqual(tampered.registry,reg);
});
test('the existing Git publication guard rejects changes to an archived receipt',()=>{
 const x=setup(),remote=join(x.dir,'remote.git');execFileSync('git',['init','-q','--bare',remote]);
 const env={...process.env,GH_TOKEN:'synthetic-test',GITHUB_REPOSITORY:'test/repo',RESEARCH_DATA_REMOTE:remote,GIT_TERMINAL_PROMPT:'0'};
 const script=new URL('.github/scripts/research-data-branch.sh',ROOT).pathname;
 const git=args=>spawnSync('bash',[script,...args],{cwd:x.dir,env,encoding:'utf8'});
 assert.equal(git(['checkout']).status,0);x.data=join(x.dir,'research-data');publish(x);
 assert.equal(git(['commit','synthetic receipt']).status,0);
 const dir=join(x.data,PROPS_RESEARCH_DIRECTORY);writeFileSync(join(dir,readdirSync(dir)[0]),'{}');
 const bad=git(['commit','synthetic rewrite']);assert.notEqual(bad.status,0);assert.match(bad.stdout,/APPEND_ONLY_VIOLATION/);
});
