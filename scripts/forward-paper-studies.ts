/** Scheduled study runner. Reuses stored props data; no provider or broker clients. */
import {readFileSync} from 'node:fs';
import {propsStore,propsStoreConfig,PropsStoreError} from '../src/lib/server/props-store.ts';
import {forwardStudyReadiness} from '../src/lib/server/forward-study-readiness.ts';
import {runFreeze,runReport,runFreezeStakes,runStakingReport,type StoredLabArtifact,type ModelFile} from '../src/lib/server/lab-sports-worker.ts';
import {freezePennyEntries,settlePennyEntries,readPennyStudy} from '../src/lib/server/penny-paper-worker.ts';
import {PROPS_SEASON_START} from '../src/lib/props/contract.ts';
const now=()=>new Date().toISOString();
const report:Record<string,unknown>={schema:'forward-paper-studies-v1',at:now(),paidRequests:0,brokerRequests:0};
try{
 const config=propsStoreConfig();report.databaseHost=config.host;
 const store=propsStore(),readiness=await forwardStudyReadiness(store);report.readiness=readiness;
 if(readiness.state!=='READY'){report.status='BLOCKED';report.action='Apply database/props/forward_studies_setup.sql to the active props project. Original paper workflows continue separately.';process.exitCode=2;}
 else if(process.argv.includes('--readiness-only'))report.status='READY';
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
