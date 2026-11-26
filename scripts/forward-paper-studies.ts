/** Scheduled study runner. Reuses stored props data; no provider or broker clients. */
import {readFileSync} from 'node:fs';
import {propsStore,propsStoreConfig,PropsStoreError} from '../src/lib/server/props-store.ts';
import {forwardStudyReadiness} from '../src/lib/server/forward-study-readiness.ts';
import {runFreeze,runReport,runFreezeStakes,runStakingReport,type StoredLabArtifact,type ModelFile} from '../src/lib/server/lab-sports-worker.ts';
import {freezePennyEntries,settlePennyEntries,readPennyStudy} from '../src/lib/server/penny-paper-worker.ts';
import {PROPS_SEASON_START} from '../src/lib/props/contract.ts';
import {EXPECTED_PROJECT} from './props-activation-preflight-lib.mjs';
const now=()=>new Date().toISOString();
const args=process.argv.slice(2);
const mode=args.length===0?'record':args.length===1&&args[0]==='--readiness-only'?'preflight':null;
const report:Record<string,unknown>={schema:'forward-paper-studies-v1',at:now(),mode:mode??'invalid',readOnly:mode!=='record',
 codeCommit:process.env.GITHUB_SHA??null,paidRequests:0,brokerRequests:0};
if(mode===null){report.status='INVALID_ARGUMENTS';report.code='FORWARD_STUDY_ARGUMENTS_INVALID';process.exitCode=2;}
else try{
 const config=propsStoreConfig();report.databaseHost=config.host;
 if(mode==='preflight'){
  report.scope='required-table-read-access';report.expectedDatabaseHost=EXPECTED_PROJECT+'.supabase.co';
  if(config.host!==report.expectedDatabaseHost)throw new PropsStoreError('WRONG_PROJECT',true);
 }
 const store=propsStore(),readiness=await forwardStudyReadiness(store);report.readiness=readiness;
 if(readiness.state!=='READY'){
  report.status='BLOCKED';report.action=readiness.state==='NOT_MIGRATED'?
   'Verify the required study schemas and database/props/forward_studies_setup.sql on the active props project.':
   'Check access to the configured props database, then repeat the read-only preflight. Inaccessible tables do not prove a missing migration.';
  process.exitCode=2;
 }
 else if(mode==='preflight')report.status='READY';
 else{
  const lab=JSON.parse(readFileSync(new URL('../src/data/lab/sports_ablation_v1.json',import.meta.url),'utf8')) as StoredLabArtifact;
  const model=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8')) as ModelFile;
  const deps={store,now,lab,model,seasonStart:PROPS_SEASON_START};
  // Freeze before any evaluation; settlement/reporting failures cannot prevent other independent studies running.
  const tasks:[string,()=>Promise<unknown>][]=[['labFreeze',()=>runFreeze(deps)],['pennyFreeze',()=>freezePennyEntries(deps)],
   ['stakingFreeze',()=>runFreezeStakes(deps)],['pennySettle',()=>settlePennyEntries(deps)],['labReport',()=>runReport(deps)],
   ['stakingReport',()=>runStakingReport(deps)],['pennyReport',()=>readPennyStudy(deps)]];
  let ok=true;for(const [key,run] of tasks){
   try{const value=await run() as {status?:string;state?:string};report[key]=value;
    if(value.status&&value.status!=='OK'||value.state&&value.state!=='ready')ok=false;
   }catch(e){report[key]={status:'ERROR',code:e instanceof PropsStoreError?e.code:e instanceof Error&&/^PENNY_[A-Z_]+$/.test(e.message)?e.message:'UNEXPECTED'};ok=false;}
  }
  report.status=ok?'OK':'ATTENTION';if(!ok)process.exitCode=1;
 }
}catch(e){report.status='UNAVAILABLE';report.code=e instanceof PropsStoreError?e.code:'UNEXPECTED';process.exitCode=1;}
console.log(JSON.stringify(report));
