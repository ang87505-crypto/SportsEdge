import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {FORWARD_TABLES} from '../src/lib/server/forward-study-readiness.ts';

const script=fileURLToPath(new URL('./forward-paper-studies.ts',import.meta.url));
const key='sb_secret_synthetic_preflight_test_only_not_a_real_key';
const host='vfyzbliksooljxrlfadp.supabase.co';
// Execute the real CLI in a fresh process. Every attempted request is intercepted; nothing reaches a network.
const harness=String.raw`
 const calls=[];
 globalThis.fetch=async(url,init)=>{
  const u=new URL(url),table=u.pathname.split('/').at(-1);
  calls.push({host:u.host,path:u.pathname,query:u.search,method:init.method,hasBody:init.body!==undefined});
  if(u.host!=='vfyzbliksooljxrlfadp.supabase.co'||init.method!=='GET')throw new Error('TEST_REFUSED_WRITE_OR_OTHER_HOST');
  const bad=process.env.TEST_STUDY_ERROR_TABLE;
  if(bad==='*'||bad===table)return new Response(JSON.stringify({code:process.env.TEST_STUDY_ERROR_CODE,
   message:'Synthetic database refusal '+process.env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY}),{status:Number(process.env.TEST_STUDY_ERROR_STATUS)});
  return new Response('[]',{status:200});
 };
 process.argv=[process.execPath,process.env.TEST_STUDY_SCRIPT,...JSON.parse(process.env.TEST_STUDY_ARGS)];
 await import(process.env.TEST_STUDY_SCRIPT);
 console.log(JSON.stringify({testTransport:calls}));
`;
function run(args,opts={}){
 const env={...process.env,SPORTSEDGE_PROPS_SUPABASE_URL:'https://'+(opts.host??host),
  SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY:opts.missingKey?'':key,GITHUB_SHA:'a'.repeat(40),
  TEST_STUDY_SCRIPT:script,TEST_STUDY_ARGS:JSON.stringify(args),TEST_STUDY_ERROR_TABLE:opts.table??'',
  TEST_STUDY_ERROR_CODE:opts.code??'42P01',TEST_STUDY_ERROR_STATUS:String(opts.status??404)};
 const child=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--input-type=module','-e',harness],
  {env,encoding:'utf8',timeout:15_000});
 assert.ifError(child.error);
 const rows=child.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const report=rows.find(r=>r.schema==='forward-paper-studies-v1');
 assert.ok(report,child.stdout+child.stderr);
 const calls=rows.find(r=>r.testTransport)?.testTransport;
 assert.ok(calls,child.stdout+child.stderr);
 assert.equal((child.stdout+child.stderr).includes(key),false,'service key must never enter the receipt');
 return {report,calls,status:child.status};
}
function assertReadOnly(calls){
 const expected=Object.values(FORWARD_TABLES).flatMap(group=>Object.keys(group)).sort();
 assert.deepEqual(calls.map(c=>c.path.split('/').at(-1)).sort(),expected);
 for(const c of calls){
  assert.equal(c.host,host);assert.equal(c.method,'GET');assert.equal(c.hasBody,false);
  const q=new URLSearchParams(c.query);assert.equal(q.get('limit'),'1');assert.ok(q.get('select'));
 }
}

test('readiness-only CLI checks all ten contracts with GETs and never starts study writes',()=>{
 const {report,calls,status}=run(['--readiness-only']);
 assert.equal(status,0);assert.equal(report.status,'READY');assert.equal(report.mode,'preflight');
 assert.equal(report.readOnly,true);assert.equal(report.scope,'required-table-read-access');
 assert.equal(report.databaseHost,host);assert.equal(report.expectedDatabaseHost,host);
 assert.equal(report.codeCommit,'a'.repeat(40));assert.equal(report.paidRequests,0);assert.equal(report.brokerRequests,0);
 assert.equal(report.readiness.tables.length,10);assert.equal('pennyFreeze' in report,false);
 assert.equal('labFreeze' in report,false);assert.equal('pennySettle' in report,false);
 assertReadOnly(calls);
});
test('a missing penny relation blocks without freezing, settling or hiding existing lab reads',()=>{
 const {report,calls,status}=run(['--readiness-only'],{table:'props_penny_entries'});
 assert.equal(status,2);assert.equal(report.status,'BLOCKED');assert.equal(report.readiness.state,'NOT_MIGRATED');
 assert.equal(report.readiness.tables.filter(t=>t.state==='READY').length,9);
 assert.equal(report.readiness.tables.find(t=>t.table==='props_penny_entries').state,'NOT_MIGRATED');
 assertReadOnly(calls);
});
test('permission refusal remains unavailable and does not recommend applying a missing migration',()=>{
 const {report,calls,status}=run(['--readiness-only'],{table:'*',code:'42501',status:403});
 assert.equal(status,2);assert.equal(report.readiness.state,'UNAVAILABLE');
 assert.match(report.action,/Check access/);assert.doesNotMatch(report.action,/Apply|forward_studies_setup/);
 assertReadOnly(calls);
});
test('preflight refuses the older allowlisted project before sending a request',()=>{
 const {report,calls,status}=run(['--readiness-only'],{host:'fzyjazhvkstvwwzjhlrr.supabase.co'});
 assert.equal(status,1);assert.equal(report.status,'UNAVAILABLE');assert.equal(report.code,'WRONG_PROJECT');
 assert.equal(report.expectedDatabaseHost,host);assert.deepEqual(calls,[]);
});
test('unknown, repeated and combined arguments cannot fall through to recording',()=>{
 for(const args of [['--preflight'],['--help'],['--readiness-only','--bogus'],['--readiness-only','--readiness-only']]){
  const {report,calls,status}=run(args);
  assert.equal(status,2);assert.equal(report.status,'INVALID_ARGUMENTS');assert.equal(report.mode,'invalid');
  assert.equal(report.code,'FORWARD_STUDY_ARGUMENTS_INVALID');assert.equal(report.readOnly,true);assert.deepEqual(calls,[]);
 }
});
test('legacy no-argument recording still stops at a missing study contract',()=>{
 const {report,calls,status}=run([],{table:'props_penny_entries'});
 assert.equal(status,2);assert.equal(report.mode,'record');assert.equal(report.readOnly,false);
 assert.equal(report.status,'BLOCKED');assertReadOnly(calls);
});
test('missing credentials are reported without a request or a fabricated ready state',()=>{
 const {report,calls,status}=run(['--readiness-only'],{missingKey:true});
 assert.equal(status,1);assert.equal(report.status,'UNAVAILABLE');assert.equal(report.code,'NOT_CONFIGURED');
 assert.deepEqual(calls,[]);
});

const workflow=readFileSync(new URL('../.github/workflows/forward-paper-studies.yml',import.meta.url),'utf8');
function job(name,source=workflow){
 const lines=source.split('\n'),start=lines.indexOf('  '+name+':');assert.ok(start>=0);
 let end=start+1;while(end<lines.length&&!/^  [a-z_]+:/.test(lines[end]))end++;
 return lines.slice(start+1,end);
}
function jobRuns(name,{event,mode='',ref='refs/heads/main',conclusion=''}){
 const lines=job(name),start=lines.findIndex(line=>line==='    if: >-');assert.ok(start>=0);
 const expression=[];
 for(let i=start+1;i<lines.length&&lines[i].startsWith('      ');i++)expression.push(lines[i].trim());
 return Boolean(runInNewContext(expression.join(' '),{github:{ref,event_name:event,event:{workflow_run:{conclusion}}},inputs:{mode}}));
}
test('actual workflow guards keep manual preflight separate from explicit record and scheduled work',()=>{
 assert.match(workflow,/options: \[preflight, record\]\n        default: preflight/);
 const cases=[
  [{event:'workflow_dispatch',mode:'preflight'},true,false],
  [{event:'workflow_dispatch'},true,false],
  [{event:'workflow_dispatch',mode:'record'},false,true],
  [{event:'workflow_dispatch',mode:'unexpected'},false,false],
  [{event:'schedule'},false,true],
  [{event:'workflow_run',conclusion:'success'},false,true],
  [{event:'workflow_run',conclusion:'failure'},false,false],
  [{event:'workflow_run',conclusion:'cancelled'},false,false],
  [{event:'pull_request'},false,false],
  [{event:'workflow_dispatch',mode:'preflight',ref:'refs/heads/unreviewed'},false,false],
  [{event:'workflow_dispatch',mode:'record',ref:'refs/heads/unreviewed'},false,false]
 ];
 for(const [context,preflight,record] of cases){
  assert.equal(jobRuns('preflight',context),preflight,JSON.stringify(context));
  assert.equal(jobRuns('record',context),record,JSON.stringify(context));
 }
 assert.match(job('preflight').join('\n'),/needs: test/);
 assert.match(job('preflight').join('\n'),/ref: \$\{\{ github.sha \}\}/);
 assert.match(job('preflight').join('\n'),/scripts\/forward-paper-studies.ts --readiness-only/);
 assert.doesNotMatch(job('record').join('\n'),/--readiness-only/);
});

function assertPinnedStudyJobs(source){
 for(const name of ['test','preflight','record']){
  const lines=job(name,source),body=lines.join('\n');
  const checkout=lines.findIndex(line=>line.startsWith('      - uses: actions/checkout@'));
  assert.ok(checkout>=0,name+' checkout is required');
  const next=lines.findIndex((line,i)=>i>checkout&&line.startsWith('      - '));
  assert.ok(next>checkout,name+' must verify the checkout before running repository code');
  const block=lines.slice(checkout,next).join('\n');
  assert.match(block,/^          ref: \$\{\{ github\.sha \}\}$/m,name+' checkout must use the tested workflow commit');
  assert.match(block,/^          persist-credentials: false$/m);
  assert.equal(lines[next],'      - name: Verify checked-out workflow commit',name+' must verify actual HEAD immediately');
  assert.equal(lines[next+1],'        run: test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',name+' must reject a mismatched receipt commit');
  assert.doesNotMatch(lines.slice(0,next+2).join('\n'),/secrets\./);
  if(name==='test')assert.doesNotMatch(body,/secrets\./);
  else assert.match(body,/needs: test/);
 }
}
test('every study job uses and verifies the tested immutable workflow commit',()=>{
 assertPinnedStudyJobs(workflow);
 // Prove the check rejects the old moving-main checkout in each actual job.
 for(const name of ['test','preflight','record']){
  const section=job(name).join('\n');
  const movingMain=workflow.replace(section,section.replace('ref: ${{ github.sha }}','ref: main'));
  assert.notEqual(movingMain,workflow);
  assert.throws(()=>assertPinnedStudyJobs(movingMain),new RegExp(name+' checkout must use the tested workflow commit'));
 }
 const unchecked=workflow.replaceAll('run: test "$(git rev-parse HEAD)" = "$GITHUB_SHA"','run: true');
 assert.throws(()=>assertPinnedStudyJobs(unchecked),/must reject a mismatched receipt commit/);
});
