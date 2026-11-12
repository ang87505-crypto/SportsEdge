/**
 * AI Learning Lab forward worker (GitHub Actions or a manual shell). RESEARCH ONLY; no provider requests.
 *   node --experimental-strip-types scripts/lab-sports.ts freeze    freeze every variant + risk flags for lines before lock
 *   node --experimental-strip-types scripts/lab-sports.ts report    forward comparison, layer verdicts, flags, mistakes, staking
 * freeze also records SHADOW-ONLY variable-stake recommendations for new virtual entries (the live $5 stake is untouched).
 * Output: one JSON line without credentials. Exit 0 also when the lab tables are not migrated (NOT_MIGRATED), so it
 * can never fail the paper workflow it runs beside.
 */
import {readFileSync} from 'node:fs';
import {propsStore,PropsStoreError} from '../src/lib/server/props-store.ts';
import {runFreeze,runReport,runFreezeStakes,runStakingReport,type StoredLabArtifact,type ModelFile} from '../src/lib/server/lab-sports-worker.ts';
import {PROPS_SEASON_START} from '../src/lib/props/contract.ts';

const kind=process.argv[2]??'';
function emit(v:Record<string,unknown>,code:number):never{process.stdout.write(JSON.stringify({kind,...v})+'\n');process.exit(code);}
if(kind!=='freeze'&&kind!=='report')emit({status:'USAGE',usage:'lab-sports.ts <freeze|report>'},2);
let store;
try{store=propsStore();}catch(e){emit({status:'NOT_CONFIGURED',detail:e instanceof PropsStoreError?e.code:'UNKNOWN'},0);}
const lab=JSON.parse(readFileSync(new URL('../src/data/lab/sports_ablation_v1.json',import.meta.url),'utf8')) as StoredLabArtifact;
const model=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8')) as ModelFile;
const deps={store,now:()=>new Date().toISOString(),lab,model,seasonStart:PROPS_SEASON_START};
try{
 // Forecasts and shadow stakes (or the two reports) run independently: one failing never blocks the other.
 const [a,b]=await Promise.allSettled(kind==='freeze'?[runFreeze(deps),runFreezeStakes(deps)]:[runReport(deps),runStakingReport(deps)]);
 const out=(x:PromiseSettledResult<{status:string}>)=>x.status==='fulfilled'?x.value:{status:'WORKER_ERROR',error:x.reason instanceof PropsStoreError?x.reason.code:'unexpected'};
 const forecasts=out(a),staking=out(b);
 const ok=(s:string)=>['OK','NOT_MIGRATED','BEFORE_FORWARD_START','UNAVAILABLE'].includes(s);
 emit({status:ok(forecasts.status)&&ok(staking.status)?'OK':'ATTENTION',forecasts,staking},ok(forecasts.status)&&ok(staking.status)?0:1);
}catch(e){emit({status:'WORKER_ERROR',error:e instanceof PropsStoreError?e.code:e instanceof Error?e.name:'unknown'},1);}
