import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {ENGINE_INDEX,parseEngineIndex,verifyEngineRun} from './archive.ts';
import {fingerprint} from './experiments.ts';

const ROOT=new URL('../../../../',import.meta.url);
const seed=()=>JSON.parse(readFileSync(new URL('research/engine/registry.json',ROOT),'utf8'));
const sha='a'.repeat(40),at='2026-11-19T17:00:00Z';
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'engine-archive-'));const data=join(dir,'data'),state=join(dir,'state');mkdirSync(state);return {dir,data,state};};
function command(x,mode,extra=[]){
 return execFileSync(process.execPath,['--experimental-strip-types','--no-warnings','scripts/research-engine-archive.ts',mode,'--data',x.data,'--state',x.state,...extra],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
function publish(x,id,status='OK',registry=seed()){
 writeFileSync(join(x.state,'registry.json'),JSON.stringify(registry));
 writeFileSync(join(x.state,'report.json'),JSON.stringify({at,status,failure:status==='FAILED'?'SYNTHETIC_FAILURE':null,domains:{sports:{clean:12,picks:{picks:4}}},forward:[]}));
 return command(x,'publish',['--run-id',id,'--source-commit',sha]);
}

test('immutable publication is repeatable; restore preserves the accepted registry and rejected ideas',()=>{
 const x=setup(),registry=seed();registry.experiments[0].disposition='SYNTHETIC retained state';
 publish(x,'100-1','OK',registry);const first=readFileSync(join(x.data,ENGINE_INDEX),'utf8');
 assert.match(parseEngineIndex(first)[0].summary,/4 selected picks/);
 assert.equal(JSON.parse(publish(x,'100-1','OK',registry)).alreadyPublished,true);
 assert.equal(readFileSync(join(x.data,ENGINE_INDEX),'utf8'),first);
 const restored={...x,state:join(x.dir,'restored')};command(restored,'restore');
 assert.deepEqual(JSON.parse(readFileSync(join(restored.state,'registry.json'),'utf8')),registry);
 assert.ok(registry.experiments.some(e=>e.status==='REJECTED'));
});

test('failed evaluations are archived but do not replace the last successful resume state',()=>{
 const x=setup(),good=seed();good.experiments[0].disposition='SYNTHETIC accepted';
 publish(x,'100-1','OK',good);publish(x,'101-1','FAILED');
 assert.equal(parseEngineIndex(readFileSync(join(x.data,ENGINE_INDEX),'utf8')).at(-1).status,'FAILED');
 const restored={...x,state:join(x.dir,'restored')};command(restored,'restore');
 assert.equal(JSON.parse(readFileSync(join(restored.state,'registry.json'),'utf8')).experiments[0].disposition,'SYNTHETIC accepted');
});

test('changed run ids cannot overwrite an existing run; tampered data and malformed indexes fail closed',()=>{
 const x=setup();publish(x,'100-1');
 const reg=seed();reg.experiments[0].disposition='SYNTHETIC changed';
 assert.throws(()=>publish(x,'100-1','OK',reg),/ENGINE_IMMUTABLE_RUN/);
 const receipt=parseEngineIndex(readFileSync(join(x.data,ENGINE_INDEX),'utf8'))[0];
 const report=JSON.parse(readFileSync(join(x.data,'learning-engine/runs/100-1/report.json'),'utf8'));
 assert.throws(()=>verifyEngineRun(receipt,reg,report),/ENGINE_DIGEST_MISMATCH/);
 assert.throws(()=>parseEngineIndex('{bad'),/JSON/);
 assert.throws(()=>parseEngineIndex(JSON.stringify({...receipt,runId:'../escape'})),/ENGINE_BAD_RUN_ID/);
 const duplicate=[receipt,receipt].map(JSON.stringify).join('\n');assert.throws(()=>parseEngineIndex(duplicate),/ENGINE_DUPLICATE_RUN/);
 assert.notEqual(fingerprint(reg),receipt.registrySha256);
});

test('the Git publisher permits only appending the engine index and adding immutable run files',()=>{
 const x=setup(),remote=join(x.dir,'remote.git');
 execFileSync('git',['init','-q','--bare',remote]);
 const env={...process.env,GH_TOKEN:'synthetic-test',GITHUB_REPOSITORY:'test/repo',RESEARCH_DATA_REMOTE:remote,GIT_TERMINAL_PROMPT:'0'};
 const script=new URL('.github/scripts/research-data-branch.sh',ROOT).pathname;
 const git=(args)=>spawnSync('bash',[script,...args],{cwd:x.dir,env,encoding:'utf8'});
 assert.equal(git(['checkout']).status,0);
 const actual={...x,data:join(x.dir,'research-data')};publish(actual,'100-1');
 assert.equal(git(['commit','synthetic first']).status,0);
 publish(actual,'101-1');assert.equal(git(['commit','synthetic second']).status,0);
 writeFileSync(join(actual.data,ENGINE_INDEX),'');const changed=git(['commit','synthetic rewrite']);
 assert.notEqual(changed.status,0);assert.match(changed.stdout,/APPEND_ONLY_VIOLATION/);
});
