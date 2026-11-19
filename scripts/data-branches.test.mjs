// Data-only branches (ops-status, research-data) must never trigger Vercel deployments, and the publishers'
// existing guarantees (history appended, append-only research data) must hold. Runs the real scripts against a
// local bare repository; no network, no token use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const repo=new URL('..',import.meta.url).pathname;
const sh=(cmd,args,opts={})=>{const r=spawnSync(cmd,args,{encoding:'utf8',...opts});return {ok:r.status===0,out:r.stdout,err:r.stderr};};
function bare(){const d=mkdtempSync(join(tmpdir(),'data-branch-'));const b=join(d,'remote.git');assert.ok(sh('git',['init','-q','--bare',b]).ok);return {d,b};}
const env=(extra)=>({...process.env,GH_TOKEN:'test-only-not-a-token',GITHUB_REPOSITORY:'owner/repo',GIT_TERMINAL_PROMPT:'0',...extra});
const show=(b,ref,path)=>sh('git',['--git-dir',b,'show',`${ref}:${path}`]);

test('vercel.json: data, docs, research and audit branches never deploy; app branches still do',()=>{
 const v=JSON.parse(readFileSync(join(repo,'vercel.json'),'utf8')).git.deploymentEnabled;
 for(const k of ['claude/**','ops-status','research-data','research/**','docs/**','audit/**'])assert.equal(v[k],false,k);
 for(const k of ['main','fix/**','release/**','feature/**'])assert.notEqual(v[k],false,k);
});

test('ops-status publisher commits vercel.json (deployments off) and appends history on every run',()=>{
 const {d,b}=bare();
 const out=join(d,'out');mkdirSync(out);
 for(const n of [1,2]){
  writeFileSync(join(out,'status.json'),JSON.stringify({run:n}));writeFileSync(join(out,'history-line.json'),JSON.stringify({run:n}));
  const r=sh('bash',[join(repo,'.github/scripts/ops-status-branch.sh'),out],{cwd:d,env:env({OPS_STATUS_REMOTE:b,GITHUB_RUN_ID:String(n)})});
  assert.ok(r.ok,r.err);
 }
 assert.deepEqual(JSON.parse(show(b,'ops-status','vercel.json').out),{git:{deploymentEnabled:false}});
 assert.deepEqual(JSON.parse(show(b,'ops-status','status.json').out),{run:2});
 const month=new Date().toISOString().slice(0,7);
 assert.equal(show(b,'ops-status',`history/${month}.jsonl`).out.trim().split('\n').length,2);
});

test('research-data publisher adds vercel.json once and keeps its append-only guard',()=>{
 const {d,b}=bare();
 const run=(args)=>sh('bash',[join(repo,'.github/scripts/research-data-branch.sh'),...args],{cwd:d,env:env({RESEARCH_DATA_REMOTE:b})});
 assert.ok(run(['checkout']).ok);
 mkdirSync(join(d,'research-data/snapshots'),{recursive:true});writeFileSync(join(d,'research-data/snapshots/a.json'),'{"a":1}');
 assert.ok(run(['commit','first']).ok);
 assert.deepEqual(JSON.parse(show(b,'research-data','vercel.json').out),{git:{deploymentEnabled:false}});
 // A fresh checkout already has it: nothing is rewritten, and the append-only rule still refuses edits.
 sh('rm',['-rf',join(d,'research-data')]);
 assert.ok(run(['checkout']).ok);
 writeFileSync(join(d,'research-data/snapshots/b.json'),'{"b":1}');
 assert.ok(run(['commit','second']).ok);
 assert.equal(sh('git',['--git-dir',b,'log','--format=%s','research-data']).out.trim(),'second\nfirst');
 writeFileSync(join(d,'research-data/snapshots/a.json'),'{"a":2}');
 const bad=run(['commit','rewrite']);
 assert.equal(bad.ok,false);assert.match(bad.out,/APPEND_ONLY_VIOLATION/);
});
