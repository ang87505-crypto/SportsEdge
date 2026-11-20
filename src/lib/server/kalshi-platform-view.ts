import type {KalshiPlatformStore} from './kalshi-platform-store.ts';
import {kalshiSchemaReady,type SavedForecast} from './kalshi-platform-worker.ts';
import {verifyContractForecast,type ContractResearchGrade} from '../prediction-markets/kalshi/contract-grade.ts';
import {replayPaperLedger,type PaperJournal} from '../prediction-markets/kalshi/paper-ledger.ts';
import {kalshiDemoConfig,type DemoAccount} from './kalshi-demo-client.ts';
import {demoIntentHistory,type DemoControl} from './kalshi-demo-worker.ts';
export type KalshiPlatformView={
 schemaVersion:'kalshi-platform-view-v1';asOf:string;
 weather:null|{target:string;recordedAt:string;status:string;trainingDays:number;matchedDays:number;blocker:string|null;
  forecastHighF:number;contracts:{label:string;probabilityPpm:number|null}[]};
 research:{gradedDays:number;modelScoredDays:number;meanAbsoluteErrorF:number|null;brier:number|null};
 lastRun:null|{status:string;startedAt:string;finishedAt:string|null;summary:Record<string,unknown>};
 demo:{state:'STOPPED'|'ARMED';readiness:string;account:DemoAccount|null;attempts:number;modelAttempts:number;smokeAttempts:number;filledOrders:number;unresolved:number;
  orders:{id:string;ticker:string;side:string;kind:string;createdAt:string;status:string;filledMicros:number|null;feesMicros:number|null;settlement:string|null}[]};
 fixture:null|{revision:number;recordedAt:string;events:number;balanceMicros:number;corrections:number};
};
export async function loadKalshiPlatformView(store:KalshiPlatformStore,asOf:string,env:Readonly<Record<string,string|undefined>>=process.env):Promise<KalshiPlatformView>{
 await kalshiSchemaReady(store);
 const [forecasts,grades,runs,controls,fixtures,snapshots,history]=await Promise.all([
  store.select<SavedForecast>('kalshi_contract_forecasts','select=*&order=target_date.desc&limit=1'),
  store.select<{document:string}>('kalshi_contract_grades','select=document&order=recorded_at.asc&limit=2001'),
  store.select<{status:string;started_at:string;finished_at:string|null;summary:Record<string,unknown>}>('kalshi_platform_runs','select=status,started_at,finished_at,summary&order=started_at.desc&limit=1'),
  store.select<DemoControl>('kalshi_demo_control','select=*&id=eq.true'),
  store.select<{revision:number;document:string;recorded_at:string}>('kalshi_fixture_ledgers','select=revision,document,recorded_at&study_id=eq.synthetic-weather-account&order=revision.desc&limit=1'),
  store.select<{document:string;key_fingerprint:string}>('kalshi_demo_account_snapshots','select=document,key_fingerprint&order=id.desc&limit=1'),
  demoIntentHistory(store)]);
 if(grades.length>2000)throw Error('KALSHI_GRADE_HISTORY_LIMIT');
 const parsedGrades=grades.map(r=>{
  const g=JSON.parse(r.document) as ContractResearchGrade;
  if(g.source!=='NWS_PRELIMINARY_RESEARCH'||g.exchangeSettlement!==false||g.profitMicros!==null||
   !Number.isFinite(g.absoluteErrorF)||g.absoluteErrorF<0||Date.parse(g.gradedAt)>Date.parse(asOf))throw Error('KALSHI_GRADE_INVALID');return g;
 });
 const latestGrades=new Map(parsedGrades.map(g=>[g.forecastId,g]));
 const gradeRows=[...latestGrades.values()],scored=gradeRows.filter(g=>g.brier!==null);
 if(scored.some(g=>!Number.isFinite(g.brier)||g.brier!<0||g.brier!>1))throw Error('KALSHI_GRADE_INVALID');
 const forecast=forecasts[0]?verifyContractForecast(JSON.parse(forecasts[0].document)):null;
 let readiness='ACCOUNT_NOT_CONFIGURED',fingerprint='';
 try{fingerprint=kalshiDemoConfig(env).fingerprint;readiness='READY_FOR_OWNER_CHECK';}
 catch(e){readiness=e instanceof Error?e.message:'KALSHI_DEMO_UNAVAILABLE';}
 let account:DemoAccount|null=null;
 if(fingerprint&&snapshots[0]?.key_fingerprint===fingerprint){
  const a=JSON.parse(snapshots[0].document) as DemoAccount;
  if(a.source!=='KALSHI_DEMO'||!Number.isSafeInteger(a.cashMicros)||a.cashMicros<0||
   !Number.isFinite(Date.parse(a.fetchedAt))||Date.parse(a.fetchedAt)>Date.parse(asOf))throw Error('KALSHI_DEMO_BAD_SNAPSHOT');account=a;
 }
 let filled=0,unresolved=0;const orders:KalshiPlatformView['demo']['orders']=[];
 for(const intent of history.intents){
  const receipts=history.receipts.filter(r=>r.intent_id===intent.id);
  const last=receipts.at(-1);if(!last||last.kind==='OUTCOME_UNKNOWN')unresolved++;
  const counts=receipts.map(r=>{const d=JSON.parse(r.document);return Number(d.filledMicros??d.order?.filledMicros??0);});
  if(counts.some(n=>!Number.isSafeInteger(n)||n<0||n>1_000_000))throw Error('KALSHI_DEMO_BAD_RECEIPT');
  const maximum=counts.length?Math.max(...counts):null;if(maximum!==null&&maximum>0)filled++;
  const reconciled=receipts.filter(r=>r.kind==='RECONCILED').at(-1),settled=receipts.filter(r=>r.kind==='SETTLED').at(-1);
  const order=reconciled?JSON.parse(reconciled.document).order:null;
  const outcome=settled?JSON.parse(settled.document).result:null;
  orders.push({id:intent.id,ticker:intent.ticker,side:intent.side,kind:intent.kind,createdAt:intent.created_at,
   status:outcome?'SETTLED':!last?'PENDING':last.kind==='OUTCOME_UNKNOWN'?'OUTCOME_UNKNOWN':last.kind==='REJECTED'?'REJECTED':order&&(order.status==='resting'||order.remainingMicros>0)?'WORKING':
    maximum===0?'NO_FILL':maximum!==null&&maximum<1_000_000?'PARTIAL_FILL':'FILLED',
   filledMicros:maximum,feesMicros:typeof order?.feesMicros==='number'?order.feesMicros:null,settlement:outcome});
 }
 let fixture:KalshiPlatformView['fixture']=null;
 if(fixtures[0]){
  const v=replayPaperLedger(JSON.parse(fixtures[0].document) as PaperJournal);
  if(v.mode!=='OFFLINE_FIXTURE')throw Error('KALSHI_FIXTURE_INVALID');
  fixture={revision:fixtures[0].revision,recordedAt:fixtures[0].recorded_at,
   events:(JSON.parse(fixtures[0].document) as PaperJournal).length,balanceMicros:v.balanceMicros,
   corrections:v.positions.reduce((n,p)=>n+Math.max(0,p.grades.length-1),0)};
 }
 const label=(r:{minF:number|null;maxF:number|null})=>r.minF===null?'≤ '+r.maxF+'°F':r.maxF===null?'≥ '+r.minF+'°F':r.minF+'–'+r.maxF+'°F';
 return {schemaVersion:'kalshi-platform-view-v1',asOf,
  weather:forecast?{target:forecast.input.targetLocalDate,recordedAt:forecasts[0].recorded_at,status:forecast.status,
   trainingDays:forecast.trainingDays,matchedDays:forecast.horizonMatchedDays,blocker:forecast.blocker,
   forecastHighF:forecast.input.forecastHighF,contracts:forecast.contracts.map(c=>({label:label(c.range),probabilityPpm:c.probabilityYesPpm}))}:null,
  research:{gradedDays:gradeRows.length,modelScoredDays:scored.length,
   meanAbsoluteErrorF:gradeRows.length?gradeRows.reduce((a,g)=>a+g.absoluteErrorF,0)/gradeRows.length:null,
   brier:scored.length?scored.reduce((a,g)=>a+g.brier!,0)/scored.length:null},
  lastRun:runs[0]?{status:runs[0].status,startedAt:runs[0].started_at,finishedAt:runs[0].finished_at,summary:runs[0].summary}:null,
  demo:{state:controls[0]?.state??'STOPPED',readiness,account,attempts:history.intents.length,
   modelAttempts:history.intents.filter(i=>i.kind==='MODEL').length,smokeAttempts:history.intents.filter(i=>i.kind==='SMOKE').length,
   filledOrders:filled,unresolved,orders:orders.reverse().slice(0,20)},fixture};
}
