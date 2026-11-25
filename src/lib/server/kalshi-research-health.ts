/** Public NOAA archive heartbeat only. No private database, account, worker or exchange capability. */
import {loadLatestIndependentWeather,loadLatestWeatherScorecard} from '../prediction-markets/kalshi/weather-memory-view.ts';
import {centralParkStandardDate,MIN_TRAINING_DAYS} from '../prediction-markets/kalshi/weather-model.ts';
export type KalshiResearchHealth={
 schemaVersion:'kalshi-research-health-v1';checkedAt:string;state:'OK'|'ATTENTION'|'UNAVAILABLE';issues:string[];
 archive:{targetDate:string|null;capturedAt:string|null;trainingPairs:number|null;requiredPairs:number;
  lastGradedDate:string|null;gradedDays:number|null};
};
type Deps={weather?:typeof loadLatestIndependentWeather;scorecard?:typeof loadLatestWeatherScorecard};
const HOUR=3_600_000;
export async function loadKalshiResearchHealth(nowIso:string,deps:Deps={}):Promise<KalshiResearchHealth>{
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('KALSHI_HEALTH_INVALID_CLOCK');
 const issues:string[]=[];
 const archive:KalshiResearchHealth['archive']={targetDate:null,capturedAt:null,trainingPairs:null,
  requiredPairs:MIN_TRAINING_DAYS,lastGradedDate:null,gradedDays:null};
 const validTime=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
 const [weather,scorecard]=await Promise.all([
  (deps.weather??loadLatestIndependentWeather)(nowIso).catch(()=>null),
  (deps.scorecard??loadLatestWeatherScorecard)(nowIso).catch(()=>null)
 ]);
 if(weather?.state==='RECORDED'&&validTime(weather.memory.capturedAt)){
  const m=weather.memory;
  archive.targetDate=m.targetLocalDate;archive.capturedAt=m.capturedAt;archive.trainingPairs=m.historicalTrainingDays;
  if(m.targetLocalDate<centralParkStandardDate(nowIso)||now-Date.parse(m.capturedAt)>36*HOUR)issues.push('FORECAST_STALE');
 }else issues.push('FORECAST_UNAVAILABLE');
 if(scorecard?.state==='RECORDED'&&scorecard.scorecard.lastDate&&
  scorecard.scorecard.lastDate<centralParkStandardDate(nowIso)){
  const s=scorecard.scorecard;archive.lastGradedDate=s.lastDate;archive.gradedDays=s.evaluatedDays;
  if(now-Date.parse(s.lastDate+'T05:00:00Z')>60*HOUR)issues.push('OUTCOME_STALE');
 }else issues.push('OUTCOME_UNAVAILABLE');
 return {schemaVersion:'kalshi-research-health-v1',checkedAt:nowIso,
  state:issues.some(x=>x.endsWith('UNAVAILABLE'))?'UNAVAILABLE':issues.length?'ATTENTION':'OK',issues,archive};
}
