/** Subscription-independent, bounded releaser for two already reviewed PAPER PRs.
 * Runs trusted main only. Reads real evidence, never runs PR code, never calls a
 * model, never submits/cancels orders, and never starts or resumes either ledger.
 */
import {readFileSync,appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {propsStore,propsStoreConfig} from '../src/lib/server/props-store.ts';
import {stagingPaperAutoStore} from '../src/lib/server/paper-auto-store.ts';
import {propsReleaseGate,stockReleaseGate,EXPIRES} from './paper-release-gates.mjs';

export const REPOSITORY='ang87505-crypto/SportsEdge';
const API='https://api.github.com';
const LIMIT=900; // below PostgREST's default page cap; refuse a possibly truncated page
const fail=code=>{throw new Error(code);};
const stamp=x=>typeof x==='string'?Date.parse(x):NaN;
const waiting=reason=>({ready:false,reason});
const config=()=>JSON.parse(readFileSync(new URL('../config/paper-auto/release-watch-20261107.json',import.meta.url),'utf8'));

export function githubClient(token,fetcher=fetch){
 if(!token)fail('GITHUB_TOKEN_NOT_CONFIGURED');
 async function request(path,{method='GET',body,logRedirect=false}={}){
  if(!path.startsWith('/repos/'+REPOSITORY+'/')&&path!=='/graphql')fail('GITHUB_PATH_REFUSED');
  let res;
  try{res=await fetcher(API+path,{method,redirect:'manual',signal:AbortSignal.timeout(20_000),
   headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});}
  catch{fail(method==='GET'?'GITHUB_READ_FAILED':'GITHUB_WRITE_OUTCOME_UNKNOWN');}
  if(logRedirect&&res.status===302){
   let u;
   try{u=new URL(res.headers.get('location'));}catch{fail('GITHUB_LOG_LOCATION_INVALID');}
   if(u.protocol!=='https:'||u.username||u.password||u.port||
    !/(^|\.)(blob\.core\.windows\.net|actions\.githubusercontent\.com)$/.test(u.hostname))
    fail('GITHUB_LOG_HOST_REFUSED');
   // Signed download, no GitHub Authorization header sent to the storage host.
   try{res=await fetcher(u.href,{redirect:'error',signal:AbortSignal.timeout(20_000)});}
   catch{fail('GITHUB_LOG_DOWNLOAD_FAILED');}
  }
  if(!res.ok)fail('GITHUB_HTTP_'+res.status);
  const bodyText=await res.text();
  if(bodyText.length>(logRedirect?10_000_000:4_000_000))fail('GITHUB_REPLY_TOO_LARGE');
  if(logRedirect)return bodyText;
  if(!bodyText)return null;
  let data;try{data=JSON.parse(bodyText);}catch{fail('GITHUB_REPLY_INVALID');}
  if(data?.errors)fail('GITHUB_GRAPHQL_REFUSED');
  return data;
 }
 return {request};
}
const path=s=>'/repos/'+REPOSITORY+'/'+s;
async function pages(gh,relative,field){
 const out=[];
 for(let page=1;page<=5;page++){
  const raw=await gh.request(path(relative+(relative.includes('?')?'&':'?')+'per_page=100&page='+page));
  const rows=field?raw[field]:raw;
  if(!Array.isArray(rows))fail('GITHUB_PAGE_INVALID');
  out.push(...rows);
  if(rows.length<100)return out;
 }
 fail('GITHUB_PAGE_LIMIT');
}

export async function reviewPull(gh,pin){
 const p=await gh.request(path('pulls/'+pin.number));
 if(p.merged===true)return {merged:true};
 if(p.state!=='open'||p.base?.ref!=='main'||p.head?.repo?.full_name!==REPOSITORY||
  p.head?.sha!==pin.head||p.head?.ref!==pin.branch)return waiting('PR_CHANGED_REVIEW_REQUIRED');
 if(p.mergeable!==true||['dirty','behind','unstable','unknown'].includes(p.mergeable_state))
  return waiting('PR_NOT_MERGEABLE');
 const files=await pages(gh,'pulls/'+pin.number+'/files');
 const actual=files.map(f=>({path:f.filename,sha:f.sha,status:f.status})).sort((a,b)=>a.path.localeCompare(b.path));
 if(JSON.stringify(actual)!==JSON.stringify(pin.files))return waiting('PR_DIFF_CHANGED_REVIEW_REQUIRED');
 const checks=await pages(gh,'commits/'+pin.head+'/check-runs','check_runs');
 const last=new Map();
 for(const c of checks){const key=c.app?.slug+':'+c.name;
  if(!last.has(key)||c.id>last.get(key).id)last.set(key,c);}
 if(pin.checks.some(name=>!last.has('github-actions:'+name)))return waiting('PR_REQUIRED_CHECK_MISSING');
 if([...last.values()].some(c=>c.head_sha!==pin.head||c.status!=='completed'||c.conclusion!=='success'))
  return waiting('PR_CHECKS_NOT_GREEN');
 const statuses=await gh.request(path('commits/'+pin.head+'/status'));
 if(statuses.total_count>0&&statuses.state!=='success')return waiting('PR_STATUS_NOT_GREEN');
 const reviews=await pages(gh,'pulls/'+pin.number+'/reviews');
 const lastReview=new Map();
 for(const r of reviews)if(['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))lastReview.set(r.user?.login,r.state);
 if([...lastReview.values()].includes('CHANGES_REQUESTED'))return waiting('PR_REVIEW_BLOCKED');
 return {ready:true,reason:'PR_REVIEWED_HEAD_GREEN',pull:p};
}

async function rows(store,table,query){
 const r=await store.select(table,query+'&limit='+LIMIT);
 if(r.length>=LIMIT)fail('LEDGER_PAGE_LIMIT');
 return r;
}
async function byIds(store,table,column,ids,select='*'){
 const unique=[...new Set(ids.map(Number))];
 if(unique.some(n=>!Number.isSafeInteger(n)||n<=0))fail('LEDGER_ID_INVALID');
 const out=[];
 for(let n=0;n<unique.length;n+=60)
  out.push(...await rows(store,table,'select='+select+'&'+column+'=in.('+unique.slice(n,n+60).join(',')+')'));
 return out;
}
export async function loadPropsEvidence(env,fetcher=fetch){
 if(propsStoreConfig(env).host!=='vfyzbliksooljxrlfadp.supabase.co')fail('PROPS_PROJECT_REFUSED');
 const store=propsStore(env,fetcher);
 const [controls,policies,runs,accounts]=await Promise.all([
  rows(store,'props_control','select=state,version,changed_at&id=eq.1'),
  rows(store,'props_budget_policy','select=*&order=active_from.desc'),
  rows(store,'props_runs','select=*&started_at=gte.2026-11-07T19:00:00Z&order=id.desc'),
  rows(store,'props_accounts','select=*')]);
 const collect=runs.find(r=>r.kind==='collect'&&r.status==='completed'&&/^gha:42404093295:/.test(r.worker));
 const e={control:controls[0],policy:policies.find(p=>stamp(p.active_from)<=Date.now()),collect,runs,accounts,
  observations:[],predictions:[],picks:[],results:[],playerGames:[],links:[],raw:[],entries:[],legs:[],settlements:[]};
 if(!collect)return e;
 [e.observations,e.predictions,e.picks,e.entries]=await Promise.all([
  rows(store,'props_observations','select=*&run_id=eq.'+collect.id),
  rows(store,'props_predictions','select=*&run_id=eq.'+collect.id),
  rows(store,'props_picks','select=*&run_id=eq.'+collect.id),
  rows(store,'props_entries','select=*&run_id=eq.'+collect.id)]);
 [e.results,e.raw,e.legs,e.settlements]=await Promise.all([
  byIds(store,'props_line_results','observation_id',e.observations.map(o=>o.id)),
  byIds(store,'props_raw_responses','id',e.observations.map(o=>o.raw_response_id),
   'id,source,endpoint,external_id,http_status,received_at,content_sha256'),
  byIds(store,'props_entry_legs','entry_id',e.entries.map(o=>o.id)),
  byIds(store,'props_entry_settlements','entry_id',e.entries.map(o=>o.id))]);
 e.playerGames=await byIds(store,'props_player_games','id',e.results.filter(r=>r.player_game_id!==null).map(r=>r.player_game_id));
 const events=[...new Set(e.observations.map(o=>o.provider_event_id))];
 if(events.some(s=>!/^[-A-Za-z0-9_]{6,80}$/.test(s)))fail('PROPS_EVENT_ID_INVALID');
 if(events.length)e.links=await rows(store,'props_game_links','select=*&provider_event_id=in.('+events.join(',')+')');
 return e;
}

export function parseManualReceipts(log){
 const out=[];
 for(const line of log.split('\n')){
  const index=line.indexOf('{"status":"DONE"');if(index<0)continue;
  try{const r=JSON.parse(line.slice(index));
   if(/^run-[a-f0-9]{32}$/.test(r.runId)&&r.kind==='execute'&&r.experimentId==='stock-v2-weekly-1')out.push(r);
  }catch{/* a command echo or an incomplete line is not a receipt */}
 }
 return out;
}
export async function manualStockReceipts(gh,pin){
 const runs=await gh.request(path('actions/workflows/paper-auto-worker.yml/runs?branch='+
  encodeURIComponent(pin.branch)+'&event=workflow_dispatch&status=success&per_page=30'));
 const receipts=[];
 for(const r of runs.workflow_runs??[]){
  if(r.head_sha!==pin.head||r.event!=='workflow_dispatch'||r.conclusion!=='success'||
   r.actor?.login!=='ang87505-crypto'||r.triggering_actor?.login!=='ang87505-crypto')continue;
  const jobs=await gh.request(path('actions/runs/'+r.id+'/jobs?per_page=100'));
  for(const j of jobs.jobs??[]){
   if(j.conclusion!=='success')continue;
   receipts.push(...parseManualReceipts(await gh.request(path('actions/jobs/'+j.id+'/logs'),{logRedirect:true})));
  }
 }
 return receipts;
}

export async function runRelease({env=process.env,gh,readProps,readStock,readReceipts,now=Date.now(),apply=false,
 pins=config()}={}){
 if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||
  !['schedule','workflow_dispatch','push'].includes(env.GITHUB_EVENT_NAME)||
  (env.GITHUB_EVENT_NAME==='push'&&apply))fail('TRUSTED_MAIN_ONLY');
 gh??=githubClient(env.GH_TOKEN);
 const result={terminal:false,expired:now>=EXPIRES,apply,systems:[]};
 for(const pin of pins){
  let review=await reviewPull(gh,pin);
  if(review.merged){result.systems.push({system:pin.system,pr:pin.number,status:'ALREADY_MERGED'});continue;}
  if(result.expired){result.systems.push({system:pin.system,pr:pin.number,status:'EXPIRED_REVIEW_REQUIRED'});continue;}
  if(!review.ready){result.systems.push({system:pin.system,pr:pin.number,status:review.reason});continue;}
  const evidence=async()=>pin.system==='props'?
   propsReleaseGate(await (readProps??(()=>loadPropsEvidence(env)))(),now):
   stockReleaseGate(await (readStock??(()=>stagingPaperAutoStore(env).call('ledger',{experiment_id:'stock-v2-weekly-1'})))(),
    await (readReceipts??(()=>manualStockReceipts(gh,pin)))(),now);
  let gate=await evidence();
  if(!gate.ready||!apply){result.systems.push({system:pin.system,pr:pin.number,status:gate.reason,ready:gate.ready});continue;}
  // Re-read both PR/CI and owner/evidence immediately before the conditional merge.
  // Owner controls remain authoritative in every worker even if STOP races this check.
  review=await reviewPull(gh,pin);gate=await evidence();
  if(review.merged){result.systems.push({system:pin.system,pr:pin.number,status:'ALREADY_MERGED'});continue;}
  if(!review.ready||!gate.ready){result.systems.push({system:pin.system,pr:pin.number,status:!review.ready?review.reason:gate.reason});continue;}
  if(review.pull.draft)await gh.request('/graphql',{method:'POST',body:{
   query:'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}',
   variables:{id:review.pull.node_id}}});
  const merged=await gh.request(path('pulls/'+pin.number+'/merge'),{method:'PUT',body:{
   sha:pin.head,merge_method:'squash',commit_title:pin.title,
   commit_message:'Owner-authorized PAPER release after independent receipt, control and exact-head CI checks. No AI runtime or real-money connection.'}});
  if(merged?.merged!==true)fail('MERGE_NOT_CONFIRMED');
  result.systems.push({system:pin.system,pr:pin.number,status:'MERGED',commit:merged.sha});
 }
 result.terminal=result.expired||result.systems.every(s=>['MERGED','ALREADY_MERGED'].includes(s.status));
 return result;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const mode=process.argv[2];if(!['check','release'].includes(mode)||process.argv.length!==3)fail('USAGE_CHECK_OR_RELEASE');
  const result=await runRelease({apply:mode==='release'});
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'terminal='+result.terminal+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
   '| System | PR | Release check |\n| --- | --- | --- |\n'+result.systems.map(s=>
    '| '+s.system+' | #'+s.pr+' | '+s.status+' |').join('\n')+
   '\n\nPaper only. No Start, Resume, Execute, collection, cancellation, data purchase or LLM call.\n'+
   (result.expired?'\nRelease window ended. Unreleased systems need owner review.\n':''));
  if(result.expired&&result.systems.some(s=>s.status==='EXPIRED_REVIEW_REQUIRED'))process.exitCode=1;
 }catch(e){console.error(JSON.stringify({status:'RELEASE_CHECK_FAILED',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'UNEXPECTED'}));process.exitCode=1;}
}
