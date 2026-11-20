import type {KalshiPlatformStore} from './kalshi-platform-store.ts';
import {loadKalshiWeatherSources} from './kalshi-weather-source.ts';
import {buildWeatherContractForecast,forecastInputFromMemory,type WeatherContractForecastV1} from '../prediction-markets/kalshi/weather-distribution.ts';
import {independentLadder} from '../prediction-markets/kalshi/weather-contract-eval.ts';
import {centralParkStandardDate} from '../prediction-markets/kalshi/weather-model.ts';
import {verifyContractForecast,gradeContractResearch} from '../prediction-markets/kalshi/contract-grade.ts';
import {kalshiDemoClient,KalshiDemoError,type KalshiDemoClient} from './kalshi-demo-client.ts';
import {runKalshiDemo,reconcileKalshiDemo,type DemoControl} from './kalshi-demo-worker.ts';
export const platformCode=(e:unknown)=>e instanceof Error?(e.message.match(/KALSHI_[A-Z0-9_]{3,100}|WEATHER_[A-Z0-9_]{3,100}/)?.[0]??'KALSHI_PLATFORM_UNAVAILABLE'):'KALSHI_PLATFORM_UNAVAILABLE';
export type SavedForecast={id:string;model_id:string;target_date:string;as_of:string;document:string;recorded_at:string};
export async function kalshiSchemaReady(store:KalshiPlatformStore){
 const [version]=await store.select<{version:string}>('kalshi_platform_version','select=version&limit=1');
 if(version?.version!=='kalshi-paper-platform-v1')throw Error('KALSHI_SCHEMA_NOT_READY');
}
export async function runKalshiPlatform(store:KalshiPlatformStore,opts:{
 slot:string;now?:()=>string;fetcher?:typeof fetch;env?:Readonly<Record<string,string|undefined>>;
 sources?:typeof loadKalshiWeatherSources;demo?:()=>KalshiDemoClient;
}){
 await kalshiSchemaReady(store);
 const lease=await store.rpc<{claimed:boolean;id?:string;token?:string;status?:string}>('kalshi_begin_run',{p_slot:opts.slot});
 if(!lease?.claimed)return {status:'DUPLICATE',priorStatus:lease?.status};
 if(!lease.id||!lease.token)throw Error('KALSHI_INVALID_LEASE');
 const now=opts.now??(()=>new Date().toISOString());
 try{
  const source=await (opts.sources??loadKalshiWeatherSources)(store,now(),opts.fetcher);
  if(!source.complete)throw Error('KALSHI_EVIDENCE_CATCHUP_REQUIRED');
  const asOf=now(),today=centralParkStandardDate(asOf);
  const latest=source.forecasts.filter(f=>f.targetLocalDate>today&&Date.parse(f.capturedAt)<=Date.parse(asOf))
   .sort((a,b)=>b.targetLocalDate.localeCompare(a.targetLocalDate))[0];
  let created=false,latestForecast:WeatherContractForecastV1|null=null;
  let saved=await store.select<SavedForecast>('kalshi_contract_forecasts','select=*&order=target_date.asc&limit=1001');
  if(saved.length>1000)throw Error('KALSHI_FORECAST_HISTORY_LIMIT');
  if(latest){
   const existing=saved.find(f=>f.target_date===latest.targetLocalDate);
   if(existing)latestForecast=verifyContractForecast(JSON.parse(existing.document));
   else{
    const forecast=buildWeatherContractForecast({input:forecastInputFromMemory(latest),asOf,
     training:source.training.filter(t=>t.localDate<latest.targetLocalDate&&Date.parse(t.observedAvailableAt)<Date.parse(asOf)),
     strikes:independentLadder(latest.forecastHighF)});
    const id=await store.rpc<string>('kalshi_record_contract_forecast',{p_document:JSON.stringify(forecast)});
    created=id===forecast.id;
    const [row]=await store.select<SavedForecast>('kalshi_contract_forecasts','select=*&id=eq.'+encodeURIComponent(id)+'&limit=1');
    if(!row)throw Error('KALSHI_FORECAST_WRITE_NOT_VERIFIED');
    latestForecast=verifyContractForecast(JSON.parse(row.document));saved=[...saved,row];
   }
  }
  const grades=await store.select<{forecast_id:string;source_id:string}>('kalshi_contract_grades','select=forecast_id,source_id&limit=2001');
  if(grades.length>2000)throw Error('KALSHI_GRADE_HISTORY_LIMIT');
  let graded=0;
  for(const row of saved){
   const forecast=verifyContractForecast(JSON.parse(row.document)),outcome=source.outcomes.find(o=>o.reportDate===forecast.input.targetLocalDate);
   if(!outcome||grades.some(g=>g.forecast_id===row.id&&g.source_id===outcome.id))continue;
   const grade=gradeContractResearch(forecast,outcome,now());
   await store.insert('kalshi_contract_grades',[{forecast_id:row.id,source_id:outcome.id,document:JSON.stringify(grade)}]);graded++;
  }
  let demoStatus='STOPPED';
  const [control]=await store.select<DemoControl>('kalshi_demo_control','select=*&id=eq.true');
  if(control?.state==='ARMED'&&latestForecast){
   try{const client=opts.demo?opts.demo():kalshiDemoClient(opts.env);
    const result=await runKalshiDemo(store,client,{forecast:latestForecast,training:source.training,kind:'MODEL',now:()=>Date.parse(now())});demoStatus=result.status;
   }catch(e){demoStatus=platformCode(e);if(!(e instanceof KalshiDemoError&&e.code==='ACCOUNT_NOT_CONFIGURED'))
    await store.rpc('kalshi_set_demo_control',{p_state:'STOPPED',p_fingerprint:null});}
  }else{
   const prior=await store.select<{id:string}>('kalshi_demo_intents','select=id&limit=1');
   if(prior.length){
    try{await reconcileKalshiDemo(store,opts.demo?opts.demo():kalshiDemoClient(opts.env));demoStatus='RECONCILED_WHILE_STOPPED';}
    catch(e){demoStatus=platformCode(e);}
   }
  }
  const summary={archiveRef:source.archiveRef,importedEvidence:source.imported,trainingPairs:source.training.length,
   forecastCreated:created,latestTarget:latestForecast?.input.targetLocalDate??null,
   modelStatus:latestForecast?.status??'NO_FUTURE_FORECAST',modelBlocker:latestForecast?.blocker??null,graded,demoStatus};
  await store.rpc('kalshi_finish_run',{p_id:lease.id,p_token:lease.token,p_status:'COMPLETED',p_summary:summary});
  return {status:'COMPLETED',...summary};
 }catch(e){
  const code=platformCode(e);
  // Source failures must not strand a previously submitted order. Stop new orders,
  // then use broker reads independently of weather availability.
  let demoStatus='STOPPED';
  try{
   const [control]=await store.select<DemoControl>('kalshi_demo_control','select=*&id=eq.true');
   if(control?.state==='ARMED')await store.rpc('kalshi_set_demo_control',{p_state:'STOPPED',p_fingerprint:null});
   const prior=await store.select<{id:string}>('kalshi_demo_intents','select=id&limit=1');
   if(prior.length){await reconcileKalshiDemo(store,opts.demo?opts.demo():kalshiDemoClient(opts.env));demoStatus='RECONCILED_AFTER_RESEARCH_FAILURE';}
  }catch(demoError){demoStatus=platformCode(demoError);}
  await store.rpc('kalshi_finish_run',{p_id:lease.id,p_token:lease.token,p_status:'FAILED',p_summary:{code,demoStatus}});
  throw Error(code);
 }
}
