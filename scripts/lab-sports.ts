/**
 * AI Learning Lab forward worker (GitHub Actions or a manual shell). RESEARCH ONLY; no provider requests.
 *   node --experimental-strip-types scripts/lab-sports.ts freeze    freeze every variant + risk flags for lines before lock
 *   node --experimental-strip-types scripts/lab-sports.ts report    forward comparison, layer verdicts, flags, mistakes
 * Output: one JSON line without credentials. Exit 0 also when the lab tables are not migrated (NOT_MIGRATED), so it
 * can never fail the paper workflow it runs beside.
 */
import {readFileSync} from 'node:fs';
import {propsStore,PropsStoreError} from '../src/lib/server/props-store.ts';
import {runFreeze,runReport,type StoredLabArtifact,type ModelFile} from '../src/lib/server/lab-sports-worker.ts';
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
 const r=kind==='freeze'?await runFreeze(deps):await runReport(deps);
 emit(r,r.status==='OK'||r.status==='NOT_MIGRATED'||r.status==='BEFORE_FORWARD_START'?0:1);
}catch(e){emit({status:'WORKER_ERROR',error:e instanceof PropsStoreError?e.code:e instanceof Error?e.name:'unknown'},1);}
