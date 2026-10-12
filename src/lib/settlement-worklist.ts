/** Determine exactly which *existing* NBA paper positions need result verification.
 * Pure, bounded and side-effect free. This is not a score source.
 */
export type PendingPosition={id:number;forecast_id:number};
export type SettledReference={position_id:number};
export type ResultReference={game_id:number};
export type NbaForecastReference={
  id:number;game_id:number;starts_at:string;
  games:{home:{name:string};away:{name:string}};
};
export type ResultWorklist={
  toVerify:NbaForecastReference[];
  alreadyRecorded:number[];
  notStarted:number[];
  settledCount:number;
  openCount:number;
};
function id(value:unknown):value is number {
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
}
export function planNbaResultChecks(input:{
  positions:PendingPosition[];
  settlements:SettledReference[];
  results:ResultReference[];
  forecasts:NbaForecastReference[];
  now:number;
}):ResultWorklist{
  const {positions,settlements,results,forecasts,now}=input;
  if(!Number.isFinite(now)||!Array.isArray(positions)||!Array.isArray(settlements)||
    !Array.isArray(results)||!Array.isArray(forecasts))
    throw new Error('Invalid NBA result-worklist input');
  // 1000 is the current PostgREST page size. A full page may mean omission.
  if([positions,settlements,results,forecasts].some(xs=>xs.length>=1000))
    throw new Error('Results reconciliation must paginate rather than silently truncate');
  const unique=new Set<number>();
  for(const p of positions){
    if(!p||!id(p.id)||!id(p.forecast_id)||unique.has(p.id))
      throw new Error('Invalid or duplicated paper position');
    unique.add(p.id);
  }
  const settled=new Set<number>();
  for(const s of settlements){
    if(!s||!id(s.position_id)||settled.has(s.position_id)||!unique.has(s.position_id))
      throw new Error('Invalid or duplicated settlement reference');
    settled.add(s.position_id);
  }
  const prior=new Set<number>();
  for(const r of results){
    if(!r||!id(r.game_id)||prior.has(r.game_id))
      throw new Error('Invalid or duplicated result reference');
    prior.add(r.game_id);
  }
  const byForecast=new Map<number,NbaForecastReference>();
  for(const f of forecasts){
    if(!f||!id(f.id)||!id(f.game_id)||byForecast.has(f.id)||
      !Number.isFinite(Date.parse(f.starts_at))||
      !f.games?.home?.name||!f.games?.away?.name)
      throw new Error('Invalid or duplicated forecast');
    byForecast.set(f.id,f);
  }
  const due=new Map<number,NbaForecastReference>();
  const alreadyRecorded=new Set<number>();
  const notStarted=new Set<number>();
  let openCount=0;
  for(const p of positions){
    if(settled.has(p.id))continue;
    openCount++;
    const f=byForecast.get(p.forecast_id);
    if(!f)throw new Error('An unsettled position has no published forecast: paginate before settling');
    const start=Date.parse(f.starts_at);
    if(start>=now){notStarted.add(f.game_id);continue;}
    if(prior.has(f.game_id)){alreadyRecorded.add(f.game_id);continue;}
    due.set(f.game_id,f);
  }
  const byStart=(a:NbaForecastReference,b:NbaForecastReference)=>
    a.starts_at.localeCompare(b.starts_at)||a.game_id-b.game_id;
  return {
    toVerify:[...due.values()].sort(byStart),
    alreadyRecorded:[...alreadyRecorded].sort((a,b)=>a-b),
    notStarted:[...notStarted].sort((a,b)=>a-b),
    settledCount:settled.size,
    openCount
  };
}
