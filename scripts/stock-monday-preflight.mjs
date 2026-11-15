/**
 * Check-only Monday stock PAPER preflight. No secrets, no Alpaca/Supabase
 * connection, no broker writes, no owner Start and no workflow dispatch.
 *
 * The public ops monitor can confirm scheduling and release configuration,
 * NOT that the private Alpaca account is clean or that an order has filled.
 * Usage: node scripts/stock-monday-preflight.mjs <ops-status/status.json>
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const REQUIRED_JOBS=['stock-decision','stock-kickoff','stock-worker'];
export function assessMondayReadiness(report,manifestText,nowIso){
 const blocked=[],checks=[],ownerActions=[];
 const check=(ok,code)=>{checks.push({code,passed:ok});if(!ok)blocked.push(code);};
 if(!report||typeof report!=='object'||Array.isArray(report))throw Error('INVALID_MONITOR_REPORT');
 if(typeof nowIso!=='string'||!Number.isFinite(Date.parse(nowIso)))throw Error('INVALID_NOW');
 const generated=Date.parse(report.generatedAt);
 check(Number.isFinite(generated)&&generated<=Date.parse(nowIso)+60000&&Date.parse(nowIso)-generated<=12*60*60*1000,
  'MONITOR_RECENT_WITHIN_12_HOURS');
 const releaseSwitches=Object.fromEntries(['paperOnly','brokerWritesEnabled','scheduledRunsEnabled','realMoneyEnabled']
  .map(k=>[k,new RegExp('\\b'+k+':\\s*(true|false)\\b').exec(manifestText)?.[1]]));
 check(releaseSwitches.paperOnly==='true'&&releaseSwitches.realMoneyEnabled==='false',
  'MAIN_PAPER_ONLY_REAL_MONEY_DISABLED');
 check(releaseSwitches.brokerWritesEnabled==='false'&&releaseSwitches.scheduledRunsEnabled==='true',
  'MAIN_SCHEDULED_SHADOW_ONLY');
 const jobs=Array.isArray(report.jobs)?report.jobs:[];
 for(const id of REQUIRED_JOBS){
  const job=jobs.find(x=>x?.id===id);
  check(job?.status==='OK'&&job?.workflowState==='active'&&job.lastSuccess?.conclusion==='success',
   'JOB_'+id.toUpperCase().replaceAll('-','_')+'_RECENT_SUCCESS');
 }
 check(report.site?.deployment?.state==='MATCHES_MAIN'&&report.site?.ok===true,
  'PRODUCTION_MATCHES_MAIN_AND_HEALTHY');
 const r=report.evidence?.release??null;
 check(r?.pr===102&&r?.state==='open'&&r?.draft===true&&r?.merged===false,
  'RELEASE_102_OPEN_DRAFT_UNMERGED');
 check(r?.stockGate?.ready===false&&r?.stockGate?.reason==='STOCK_SUPERVISED_EXECUTE_REQUIRED',
  'FIRST_SUPERVISED_EXECUTION_STILL_PENDING');
 const important=report.blockers??[];
 if(Array.isArray(important)&&important.some(x=>x?.id==='stock-first-session')){
  ownerActions.push('OWNER_FIRST_PAPER_EXECUTE_STOP_RECONCILE_START_CLOSE');
 }
 ownerActions.push('OWNER_SIGN_IN_CHECK_ALPACA_ACCOUNT_AND_ARM_GATE');
 ownerActions.push('VERIFY_MONDAY_TARGETS_DECISION_FROZEN_BEFORE_EXECUTE');
 ownerActions.push('VERIFY_POST_FILL_ORDER_INTENT_ACTIVITY_AND_CLEAN_CLOSE_MARK');
 const warnings=[
  'CHECK_ONLY: monitor data is not an authenticated broker account or order receipt.',
  'The private stock ledger, account eligibility, owner ARM, and matched PAPER fills MUST be checked in the owner dashboard.',
  'Scheduled GitHub runs may be late or missed; use recorded receipts, not planned times.',
  'One PAPER session creates forward evidence, not a statistically validated learning or profit strategy.'
 ];
 const worker=jobs.find(x=>x?.id==='stock-worker');
 if((worker?.slots7d?.missed??0)>0)warnings.push('Some recent stock-worker cron slots were missed; monitor Vercel backup and actual execution receipts.');
 return {status:blocked.length?'BLOCKED':'PREPARED_FOR_OWNER_SUPERVISED_PAPER_TEST',
  checkedAt:nowIso,monitorGeneratedAt:report.generatedAt??null,blocked,checks,
  ownerActions:[...new Set(ownerActions)],warnings};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const p=process.argv[2];if(!p){console.error('Usage: node scripts/stock-monday-preflight.mjs <status.json>');process.exitCode=2;}
 else try{
  const report=JSON.parse(readFileSync(p,'utf8'));
  const manifest=readFileSync('src/lib/stocks/paper-auto-release.ts','utf8');
  const result=assessMondayReadiness(report,manifest,new Date().toISOString());
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.status==='BLOCKED')process.exitCode=1;
 }catch(e){console.error(e instanceof Error?e.message:'UNKNOWN_PREFLIGHT_ERROR');process.exitCode=2;}
}
