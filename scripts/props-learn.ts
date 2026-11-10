/**
 * NBA player-prop learning worker (GitHub Actions or a manual shell). PAPER ONLY.
 *   node --experimental-strip-types scripts/props-learn.ts <kind> [--version V] [--reason R]
 *     train      retrain a challenger, check it on held-out data, shadow or drop it
 *     evaluate   score shadowing challengers under the registered gate; auto-switch if allowed
 *     review     weekly mistake review and layer scorecards
 *     learning_on|learning_off|auto_on|auto_off|rollback --reason R     owner control (never from a schedule)
 *     approve --version props-learn-vN --reason R                       owner approval (never from a schedule)
 * train needs PROPS_HISTORY_PRIOR and PROPS_HISTORY_SEASON: the pinned SportsDataverse box-score CSVs.
 * Output: one JSON line without credentials. Exit 1 when the owner must look.
 */
import {propsStore,PropsStoreError} from '../src/lib/server/props-store.ts';
import {runTrain,runEvaluate,runReview,runOwnerAction,OWNER_KINDS,type OwnerKind,type TrainItem} from '../src/lib/server/props-learn-worker.ts';
import {buildHistoricalItems} from './lib/learn-history.ts';

function emit(v:Record<string,unknown>,code:number):never{process.stdout.write(JSON.stringify(v)+'\n');process.exit(code);}
const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:undefined;};
const kind=process.argv[2]??'';
const KINDS=['train','evaluate','review',...OWNER_KINDS];
if(!KINDS.includes(kind))emit({status:'USAGE',usage:'props-learn.ts <'+KINDS.join('|')+'>'},2);
const owner=(OWNER_KINDS as readonly string[]).includes(kind);
if(process.env.GITHUB_EVENT_NAME==='schedule'&&owner)emit({status:'OWNER_ACTION_NOT_SCHEDULABLE',kind},1);
const reason=(arg('reason')??'').trim(),version=arg('version');
if(owner&&(reason.length<3||reason.length>300))emit({status:'USAGE',usage:kind+' requires --reason "<3-300 chars>"'},2);
if(kind==='approve'&&!/^props-learn-v[0-9]+$/.test(version??''))emit({status:'USAGE',usage:'approve requires --version props-learn-vN'},2);

let store;
try{store=propsStore();}catch(e){emit({status:'NOT_CONFIGURED',kind,detail:e instanceof PropsStoreError?e.code:'UNKNOWN'},1);}
const now=()=>new Date().toISOString();
try{
 if(owner){
  const actor=('owner:'+(process.env.GITHUB_ACTOR??'local')).toLowerCase().replace(/[^a-z0-9:._-]/g,'-').slice(0,100);
  emit({status:'RECORDED',kind,result:await runOwnerAction(store,kind as OwnerKind,{version,reason,actor})},0);
 }
 if(kind==='train'){
  const prior=process.env.PROPS_HISTORY_PRIOR,season=process.env.PROPS_HISTORY_SEASON;
  if(!prior||!season)emit({status:'HISTORY_NOT_CONFIGURED',kind},1);
  // Layer-1 dispersion over the whole pinned season, as frozen in src/data/props/model_v1.json.
  const h=buildHistoricalItems(prior,season,'2100-01-01T00:00:00Z');
  const historical:TrainItem[]=h.items.map(x=>({stat:x.stat,input:{base:x.base,market:null,matchup:x.matchup},y:x.y,at:x.at,
   key:x.key,eventId:x.eventId,date:x.date}));
  const r=await runTrain({store,now,historical});
  emit({kind,...r,history:{items:h.items.length,leakage:{checked:h.checked,violations:h.violations},sources:h.sources}},
   String(r.status).startsWith('FAILED')?1:0);
 }
 if(kind==='evaluate')emit({kind,...await runEvaluate({store,now})},0);
 emit({kind,...await runReview({store,now})},0);
}catch(e){
 emit({status:'WORKER_ERROR',kind,error:e instanceof PropsStoreError?e.code:e instanceof Error?(/^PROPS_[A-Z0-9_]{3,60}$/.exec(e.message)?.[0]??e.name):'unknown'},1);
}
