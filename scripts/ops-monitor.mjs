/** Operations monitor. Runs on GitHub Actions; needs no AI service, conversation or personal computer.
 * Reads workflow runs, real receipts (props ledger, research summary), probes the live site and checks
 * credential presence/expiry, then writes a public status file. It never changes a control, dispatches a
 * job, places an order or prints a secret. Usage: node scripts/ops-monitor.mjs <out-dir>
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {workflowCrons,evaluateJob,rollUp,keyExpiry,propsReceiptBlockers,applyReleaseSwitch} from './ops-monitor-lib.mjs';
import {stockReleaseGate,EXPIRES} from './paper-release-gates.mjs';
import {githubClient,manualStockReceipts} from './paper-release.mjs';
import {stagingPaperAutoStore} from '../src/lib/server/paper-auto-store.ts';
import {compareDeployment} from '../src/lib/deployment-identity.ts';
import {PROPS_COLLECTION_V2} from '../src/lib/props/schedule.ts';

const REPO='ang87505-crypto/SportsEdge',API='https://api.github.com';
const ROOT=new URL('../',import.meta.url);
const cfg=JSON.parse(readFileSync(new URL('config/ops/jobs.json',ROOT),'utf8'));
const outDir=process.argv[2]||'ops-out';
const env=process.env,nowMs=Date.now(),nowIso=new Date(nowMs).toISOString();
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url,{headers={},method='GET',body,attempts=3}={}){
 let last;
 for(let i=1;i<=attempts;i++){
  try{
   const res=await fetch(url,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(20_000)});
   if(res.status===429||res.status>=500){last=new Error('HTTP_'+res.status);await delay(1500*i);continue;}
   const text=await res.text();
   return {status:res.status,ok:res.ok,text,json:(()=>{try{return JSON.parse(text);}catch{return null;}})()};
  }catch(e){last=e;await delay(1500*i);}
 }
 throw last??new Error('FETCH_FAILED');
}
const ghHeaders={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
 ...(env.GH_TOKEN?{Authorization:'Bearer '+env.GH_TOKEN}:{}),'User-Agent':'sportsedge-ops-monitor'};
async function gh(path){
 const r=await getJson(API+'/repos/'+REPO+path,{headers:ghHeaders});
 if(!r.ok)throw new Error('GITHUB_HTTP_'+r.status);
 return r.json;
}

// ---------- jobs ----------
const workflowCache=new Map();
async function workflowData(file){
 if(!workflowCache.has(file))workflowCache.set(file,(async()=>{
  const [wf,runs]=await Promise.all([gh('/actions/workflows/'+file),
   gh('/actions/workflows/'+file+'/runs?branch=main&per_page=100&exclude_pull_requests=true')]);
  const text=readFileSync(new URL('.github/workflows/'+file,ROOT),'utf8');
  return {state:wf.state,createdAt:Date.parse(wf.created_at),crons:workflowCrons(text),
   runs:(runs.workflow_runs||[]).filter(r=>r.event!=='pull_request').sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))};
 })());
 return workflowCache.get(file);
}
async function evaluate(job){
 const base={id:job.id,label:job.label,area:job.area,required:!!job.required,workflow:job.workflow,note:job.note??null,
  historyUrl:`https://github.com/${REPO}/actions/workflows/${job.workflow}`};
 try{
  const d=await workflowData(job.workflow);
  let runs=d.runs;
  if(job.events)runs=runs.filter(r=>job.events.includes(r.event));
  if(job.startedWithinMinutes){
   // Only runs that began shortly after one of this job's own planned times are its evidence.
   const [lo,hi]=job.startedWithinMinutes;
   runs=runs.filter(r=>{const t=Date.parse(r.run_started_at||r.created_at),d0=new Date(t);
    return [1,2,3,4,5].includes(d0.getUTCDay())&&job.crons.some(c=>{const [m,h]=c.split(' ').map(Number);
     const fire=Date.UTC(d0.getUTCFullYear(),d0.getUTCMonth(),d0.getUTCDate(),h,m);return t>=fire+lo*60_000&&t<=fire+hi*60_000;});});
  }
  const e={...base,...evaluateJob(job,{workflowState:d.state,runs,crons:job.crons??d.crons,nowMs,activeSinceMs:d.createdAt})};
  // Switch state is read from the reviewed source on main, never inferred from the runs.
  return job.releaseSwitch==='props-capture'?applyReleaseSwitch(e,PROPS_COLLECTION_V2.tickEnabled===true):e;
 }catch(e){
  if(job.workflow==='ops-monitor.yml')return {...base,status:'RUNNING',detail:'This run is producing the status.',schedule:[],nextPlanned:[],
   lastRun:null,lastSuccess:null,lastFailure:null,running:null,lastScheduledSuccess:null,consecutiveFailures:0,slots7d:{due:0,missed:0,lastMissedAt:null},workflowState:null};
  return {...base,status:'UNKNOWN',detail:'Could not read run history: '+String(e.message).slice(0,60),schedule:[],nextPlanned:[],
   lastRun:null,lastSuccess:null,lastFailure:null,running:null,lastScheduledSuccess:null,consecutiveFailures:0,slots7d:{due:0,missed:0,lastMissedAt:null},workflowState:null};
 }
}

// ---------- real receipts ----------
async function propsEvidence(){
 const url=env.SPORTSEDGE_PROPS_SUPABASE_URL,key=env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY;
 if(!url||!key)return {state:'NOT_CONFIGURED'};
 let u;try{u=new URL(url);}catch{return {state:'INVALID_CONFIG'};}
 if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co'))return {state:'INVALID_CONFIG'};
 const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),Accept:'application/json'};
 try{
  // Per kind: capture ticks add a collect run about every 30 minutes; settles must stay visible.
  const sel=u.origin+'/rest/v1/props_runs?select=id,kind,status,outcome,started_at,finished_at&order=id.desc';
  const [control,collects,settles]=await Promise.all([
   getJson(u.origin+'/rest/v1/props_control?select=state,changed_at&id=eq.1',{headers}),
   getJson(sel+'&kind=eq.collect&limit=40',{headers}),getJson(sel+'&kind=eq.settle&limit=10',{headers})]);
  const bad=[collects,settles].find(r=>!r.ok||!Array.isArray(r.json));
  if(!control.ok||bad)return {state:'UNAVAILABLE',httpStatus:(bad??control).status};
  const runs={json:[...collects.json,...settles.json].sort((a,b)=>b.id-a.id)};
  const pick=kind=>{const r=runs.json.find(x=>x.kind===kind);return r?{kind,status:r.status,outcome:r.outcome??null,startedAt:r.started_at,finishedAt:r.finished_at??null}:null;};
  const okRun=kind=>{const r=runs.json.find(x=>x.kind===kind&&x.status==='completed'&&x.outcome==='COMPLETED');return r?r.finished_at:null;};
  return {state:'OK',controlState:control.json?.[0]?.state??null,lastCollect:pick('collect'),lastSettle:pick('settle'),
   lastCompletedCollectAt:okRun('collect'),lastCompletedSettleAt:okRun('settle')};
 }catch{return {state:'UNAVAILABLE'};}
}
async function researchEvidence(){
 try{
  const r=await getJson('https://raw.githubusercontent.com/'+REPO+'/research-data/summary.json');
  if(!r.ok||!r.json)return {state:r.status===404?'NOT_PUBLISHED':'UNAVAILABLE'};
  const s=r.json;
  return {state:'OK',schemaVersion:s.schemaVersion??null,generatedAt:s.generatedAt??null,overall:s.overall??null,
   forwardAt:s.forwardAt??null,sources:(s.sources||[]).slice(0,12).map(x=>({id:x.id,status:x.status,retrievedAt:x.retrievedAt??null,lastSuccessAt:x.lastSuccessAt??null,
    failedKeys:Array.isArray(x.lastBatch?.failed)?x.lastBatch.failed.slice(0,6).map(f=>({key:String(f.key).slice(0,40),error:f.error?String(f.error).split(' ')[0].slice(0,40):null})):[]})),
   candidates:(s.candidates||[]).slice(0,3).map(c=>({id:c.id,active:c.active,verdict:c.historical?.verdict??'NOT_EVALUATED',forwardStatus:c.forward?.status??null,forwardSessions:c.forward?.sessions??0}))};
 }catch{return {state:'UNAVAILABLE'};}
}
/** Check-only evaluation of the pinned stock release gate (the same function the temporary watcher used).
 * Never merges, never extends the watcher's window. Publishes only the gate's outcome code. */
async function stockGate(){
 if(!env.SPORTSEDGE_STAGING_SUPABASE_URL||!env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY||!env.GH_TOKEN)return {ready:false,reason:'GATE_NOT_CHECKED_HERE'};
 try{
  const pin=JSON.parse(readFileSync(new URL('config/paper-auto/release-watch-20261107.json',ROOT),'utf8')).find(p=>p.system==='stocks');
  const ledger=await stagingPaperAutoStore(env).call('ledger',{experiment_id:'stock-v2-weekly-1'});
  const receipts=await manualStockReceipts(githubClient(env.GH_TOKEN),pin);
  const g=stockReleaseGate(ledger,receipts,nowMs);
  return {ready:g.ready,reason:g.reason,pinnedHead:pin.head.slice(0,12)};
 }catch(e){return {ready:false,reason:'GATE_CHECK_FAILED',detail:/^[A-Z0-9_]+$/.test(e.message)?e.message:'UNEXPECTED'};}
}
async function releaseEvidence(){
 try{
  const p=await gh('/pulls/102');
  const merged=!!p.merged_at;
  return {pr:102,title:String(p.title).slice(0,120),state:p.state,draft:!!p.draft,merged,url:p.html_url,
   watcherWindowEndedAt:new Date(EXPIRES).toISOString(),stockGate:merged?{ready:true,reason:'ALREADY_MERGED'}:await stockGate(),
   rule:'Release only after a genuine owner-supervised first paper session passes the pinned gate. After the watcher window the owner reviews and merges; nothing merges automatically.'};
 }catch{return {pr:102,state:'UNKNOWN'};}
}

// ---------- live site ----------
async function siteChecks(){
 const base=cfg.site,checks=[];
 const pending=[];
 async function check(name,fn){
  const t0=Date.now();
  try{const detail=await fn();checks.push({name,ok:true,ms:Date.now()-t0,detail:detail??null});}
  catch(e){checks.push({name,ok:false,ms:Date.now()-t0,detail:String(e.message).slice(0,120)});pending.push([name,fn]);}
 }
 // A deployment that is still rolling out (or a cold start) should not raise an alert: retry failures once.
 async function retryFailures(){
  if(!pending.length)return;
  await delay(60_000);
  for(const [name,fn] of pending){
   const i=checks.findIndex(c=>c.name===name),t0=Date.now();
   try{const detail=await fn();checks[i]={name,ok:true,ms:Date.now()-t0,detail:(detail??'')+' (passed on retry)'};}
   catch(e){checks[i]={name,ok:false,ms:Date.now()-t0,detail:String(e.message).slice(0,100)+' (also failed on retry)'};}
  }
 }
 const page=(path,text)=>async()=>{const r=await getJson(base+path);if(r.status!==200)throw new Error('HTTP '+r.status);
  if(text&&!r.text.includes(text))throw new Error('missing "'+text+'"');return 'HTTP 200';};
 const ask=async(message,context=null)=>{const r=await getJson(base+'/api/assistant',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({message,context}),attempts:2});
  if(r.status!==200||r.json?.status!=='ok')throw new Error('HTTP '+r.status);return r.json.reply;};
 await check('Overview page',page('/','SportsEdge'));
 await check('Ask SportsEdge page',page('/assistant','Ask SportsEdge'));
 await check('Automation page',page('/automation','Paper automation'));
 await check('Strategy research page',page('/stocks/research'));
 await check('PrizePicks page',page('/paper-betting/props'));
 await check('Chat: sports',async()=>{const r=await ask("Tonight's picks");if(!r?.text)throw new Error('empty reply');return 'answered';});
 await check('Chat: research and follow-up',async()=>{const r=await ask('Momentum research results');
  if(r?.context?.domain!=='research')throw new Error('not routed to research');
  const f=await ask('Why?',r.context);if(!/Failed checks|failed|check/i.test(f?.text??''))throw new Error('follow-up lost its topic');return 'answered';});
 await check('Chat: combined status',async()=>{const r=await ask('Is everything running?');
  for(const h of ['Sports','Stock account','Stock research','Background jobs'])if(!r?.text?.includes(h))throw new Error('missing '+h);
  if(/Background jobs\n(The operations monitor has not published|Background job status is unavailable)/.test(r.text))throw new Error('chat cannot read the job status');return 'answered';});
 await check('Owner protection: stock account in chat',async()=>{const r=await ask('Stock results');
  if(!/Sign in/i.test(r?.text??''))throw new Error('stock account answered without owner sign-in');if(r.private)throw new Error('private flag on anonymous reply');return 'requires sign-in';});
 await check('Owner protection: session probe',async()=>{const r=await getJson(base+'/api/assistant');
  if(r.status!==200||r.json?.ownerAccess!==false)throw new Error('anonymous session reported owner access');return 'no owner access';});
 await check('Owner protection: stock autopilot API',async()=>{const r=await getJson(base+'/api/internal/paper-auto',{attempts:1});
  if(r.status<400||r.status>=500)throw new Error('HTTP '+r.status+' without owner session');return 'HTTP '+r.status;});
 await check('Owner protection: cron kickoff',async()=>{const r=await getJson(base+'/api/internal/paper-auto/kickoff',{attempts:1});
  if(r.status!==401)throw new Error('HTTP '+r.status+' without cron secret');return 'HTTP 401';});
 await check('Owner protection: backup scheduler',async()=>{const r=await getJson(base+'/api/internal/scheduler/ops-monitor',{attempts:1});
  if(r.status!==401)throw new Error('HTTP '+r.status+' without cron secret');return 'HTTP 401';});
 await retryFailures();
 return {url:base,checkedAt:new Date().toISOString(),ok:checks.every(c=>c.ok),checks,deployment:await deploymentCheck(base)};
}
/** Which commit production serves, against main's head. Informational until /api/version is deployed (UNKNOWN). */
async function deploymentCheck(base){
 try{
  const [v,head]=await Promise.all([getJson(base+'/api/version',{attempts:2}),gh('/commits/main')]);
  const id=v.ok&&v.json?.schemaVersion==='deployment-identity-v1'?v.json:null;
  const main=head?.sha?{sha:head.sha,committedAt:head.commit?.committer?.date??''}:null;
  return {...compareDeployment(id,main,nowMs),deployedSha:id?.commitSha??null,deployedRef:id?.commitRef??null,mainSha:main?.sha??null};
 }catch{return {state:'UNKNOWN',detail:'Could not read the deployment identity.',deployedSha:null,deployedRef:null,mainSha:null};}
}

// ---------- credentials (presence and expiry only; values never leave the process) ----------
function credentials(){
 const has=name=>env['HAS_'+name]==='true'?true:env['HAS_'+name]==='false'?false:null;
 const gha=[
  ['SPORTSEDGE_PROPS_SUPABASE_URL','props jobs, monitor'],['SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY','props jobs, monitor'],
  ['ODDS_API_KEY','props collection'],['SPORTSEDGE_STAGING_SUPABASE_URL','stock paper jobs'],
  ['SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY','stock paper jobs'],['ALPACA_PAPER_AUTO_KEY_ID','stock paper jobs, research market data'],
  ['ALPACA_PAPER_AUTO_SECRET_KEY','stock paper jobs, research market data'],['SEC_EDGAR_USER_AGENT','research SEC collection'],
  ['SPORTSEDGE_PAPER_AUTO_OWNER_REF','owner-only stock controls']];
 const out=gha.map(([name,usedBy])=>({name,store:'GitHub Actions repository secret',usedBy,present:has(name),
  expiresAt:/SERVICE_KEY$/.test(name)?keyExpiry(env[name]??''):null}));
 out.push({name:'CRON_SECRET + SPORTSEDGE_GITHUB_DISPATCH_TOKEN',store:'Vercel project environment (Production)',
  usedBy:'early stock decision kickoff',present:null,expiresAt:null,
  note:'Not readable from GitHub. Verified indirectly by the stock-kickoff job: a dispatch shortly after 09:00 UTC on a weekday.'});
 return out;
}

// ---------- blockers ----------
function blockers(jobs,props,research,release,site,creds){
 const out=[];
 const add=(id,text,action)=>out.push({id,text,action});
 for(const j of jobs){
  if(['FAILING','DISABLED','STALE'].includes(j.status))add('job:'+j.id,`${j.label}: ${j.detail}`,`Open ${j.historyUrl} and read the latest failed run.`);
  if(j.id==='stock-kickoff'&&['MISSED_SLOT','STALE'].includes(j.status))
   add('kickoff',`${j.label}: no early dispatch seen after the latest 09:00 UTC weekday cron.`,
    'Vercel → sports-edge project → Settings → Environment Variables (Production): check CRON_SECRET and SPORTSEDGE_GITHUB_DISPATCH_TOKEN (fine-grained token with Actions: write on this repository, not expired).');
 }
 for(const c of creds){
  if(c.present===false)add('secret:'+c.name,`${c.name} is not set (${c.usedBy}).`,`GitHub → Settings → Secrets and variables → Actions → New repository secret: ${c.name}.`);
  if(c.expiresAt&&/^\d{4}-/.test(c.expiresAt)&&Date.parse(c.expiresAt)-nowMs<30*86400_000)
   add('expiry:'+c.name,`${c.name} expires ${c.expiresAt.slice(0,10)}.`,'Rotate it in Supabase and update the GitHub secret before then.');
 }
 if(props.state==='OK'&&props.controlState&&props.controlState!=='RUNNING')
  add('props-control',`Sports props automation is ${props.controlState} by its owner control.`,'PrizePicks page → Controls → Resume (owner sign-in), when you want it running.');
 for(const b of propsReceiptBlockers(props,nowMs))add(b.id,b.text,b.action);
 if(research.state==='OK')for(const s of research.sources)if(['NOT_CONFIGURED','FETCH_FAILED','PARSE_FAILED','SCHEMA_CHANGED','BLOCKED'].includes(s.status))
  add('research-source:'+s.id,`Research source ${s.id} last reported ${s.status}${s.retrievedAt?' at '+s.retrievedAt.slice(0,16).replace('T',' ')+' UTC':''}`+
   (s.failedKeys?.length?` (failed: ${s.failedKeys.map(f=>f.key+(f.error?' '+f.error:'')).join(', ')})`:'')+
   `; last success ${s.lastSuccessAt?s.lastSuccessAt.slice(0,10):'never'}.`,
   'Research only: no active strategy uses it. Open the research-data branch manifest.jsonl for the exact URL and error; a 404 for a recent quarter usually means the file is not published yet.');
 if(research.state==='OK'&&research.generatedAt&&nowMs-Date.parse(research.generatedAt)>100*3600_000)
  add('research-stale',`The research summary is older than 100 hours (${research.generatedAt}).`,'Check the research-collect workflow.');
 if(release.state==='open'&&!release.merged)
  add('stock-first-session',`PR #${release.pr} (stock PAPER orders) is not released: it needs a genuine owner-supervised first paper session. Release gate: ${release.stockGate?.ready?'passed — ready for your review and merge':'not passed ('+(release.stockGate?.reason??'unknown')+')'}.`,
   'See docs/AUTOMATION_OPERATIONS_2026_11_10.md → "First supervised stock paper session". Nothing is automatic about this step.');
 // Read from the reviewed source on main, so the item disappears by itself once activation is merged.
 if((PROPS_COLLECTION_V2.tickEnabled)!==true)
  add('props-capture-activation','Event-aware props capture (props-capture-v1) is merged but released off: the legacy two-slot collection keeps running unchanged.',
   'Owner decision: follow docs/PROPS_CAPTURE_ACTIVATION_CHECKLIST_2026_11_11.md (apply props_capture_v1.sql, optional v3 accounting at the same 7/200 limits, one supervised tick, then tickEnabled:true).');
 if(['BEHIND_MAIN','WRONG_BRANCH'].includes(site.deployment?.state))
  add('deployment',site.deployment.detail,'Vercel → sports-edge project → Deployments: open the latest Production build for main and read its error (or Promote the correct main deployment).');
 if(!site.ok)add('site',`Live site checks failed: ${site.checks.filter(c=>!c.ok).map(c=>c.name).join(', ')}.`,'Open the site and the latest Vercel deployment.');
 return out;
}

// ---------- main ----------
const jobs=[];
for(const job of cfg.jobs)jobs.push(await evaluate(job));
const [props,research,release,site]=await Promise.all([propsEvidence(),researchEvidence(),releaseEvidence(),siteChecks()]);
const creds=credentials();
const blockerList=blockers(jobs,props,research,release,site,creds);
const roll=rollUp(jobs);
const overall={state:!site.ok||roll.state==='ATTENTION'?'ATTENTION':roll.state==='WARN'||blockerList.length?'WARN':'OK',attention:roll.attention};
const status={schemaVersion:'ops-status-v1',generatedAt:nowIso,timezoneShown:'America/Denver',
 monitorRun:env.GITHUB_RUN_ID?{id:Number(env.GITHUB_RUN_ID),url:`https://github.com/${REPO}/actions/runs/${env.GITHUB_RUN_ID}`,event:env.GITHUB_EVENT_NAME??null}:null,
 overall,jobs,evidence:{props,research,release},site,credentials:creds,blockers:blockerList,
 notes:['Planned times come from cron schedules and are not executions. Executions link to real GitHub runs.',
  'GitHub can start scheduled runs late or drop them under load; MISSED_SLOT means a planned time passed without any run.',
  'Stock account balances, positions and gate state are owner-only and are not in this public file.']};
mkdirSync(outDir,{recursive:true});
writeFileSync(outDir+'/status.json',JSON.stringify(status,null,1));
writeFileSync(outDir+'/history-line.json',JSON.stringify({at:nowIso,run:status.monitorRun?.id??null,overall:overall.state,
 site:site.ok,jobs:Object.fromEntries(jobs.map(j=>[j.id,j.status])),blockers:blockerList.map(b=>b.id)}));
console.log(JSON.stringify({overall,site:site.ok,jobs:jobs.map(j=>j.id+':'+j.status),blockers:blockerList.map(b=>b.id)}));
