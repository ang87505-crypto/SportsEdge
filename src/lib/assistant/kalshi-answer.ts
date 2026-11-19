/**
 * Honest, zero-Kalshi-API answers for the independent prediction-market
 * research panel. Only interprets cached public NOAA archive evidence.
 * NWS forecast accuracy is not a Kalshi bet, quote, P&L or settlement.
 */
import type {Reply,Card} from './answer.ts';
import type {QuestionRoute} from './domain.ts';
import type {LatestWeatherResearch} from '../prediction-markets/kalshi/weather-memory-view.ts';
import type {WeatherScorecard} from '../prediction-markets/kalshi/weather-scorecard.ts';
export type KalshiPublicResearch={
 checkedAt:string;
 weather:LatestWeatherResearch;
 scorecard:{state:'RECORDED';scorecard:WeatherScorecard}|
  {state:'AWAITING_FIRST_ARCHIVE'|'ARCHIVE_UNAVAILABLE';scorecard:null};
};
const SUGGEST=['What has Kalshi weather research recorded?',
 'How accurate is the independent weather model?',
 'Are there real Kalshi opportunities yet?',
 'Is the NOAA archive collecting?'];
const LINKS:Card={kind:'links',items:[
 {label:'Independent Kalshi research',href:'/prediction-markets/kalshi'},
 {label:'Research archive',href:'https://github.com/ang87505-crypto/SportsEdge/tree/research-data/kalshi-independent/nyc-weather'},
 {label:'Weather collector runs',href:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/kalshi-independent-weather-memory.yml'},
]};
const pct=(value:number)=>(value*100).toFixed(1)+'%';
const timestamp=(iso:string)=>new Intl.DateTimeFormat('en-US',{
 timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
 timeZoneName:'short'
}).format(new Date(iso));
export function kalshiPublicAnswer(q:QuestionRoute,view:KalshiPublicResearch):Reply{
 const ctx={domain:'kalshi' as const,topic:q.topic};
 const w=view.weather,s=view.scorecard;
 const score=s.state==='RECORDED'?s.scorecard:null;
 const archiveState=w.state;
 let archiveText:string;
 if(w.state==='RECORDED'){
  archiveText='A frozen independent NWS grid forecast for '+w.memory.targetLocalDate+' was captured '+timestamp(w.memory.capturedAt)+
   '. Modeled high: '+w.memory.forecastHighF+'°F (experimental '+w.memory.bandLowF+'–'+w.memory.bandHighF+
   '°F range). This is not an official Central Park station high or a Kalshi contract.';
 }else if(w.state==='ARCHIVE_UNAVAILABLE'){
  archiveText='The independent NOAA archive could not be verified. Missing or invalid evidence is not proof of zero activity. Check workflow receipts.';
 }else{
  archiveText='No recent frozen NOAA forecast appears in the archive window. This does not establish whether older runs succeeded; check the collector and research-data branch.';
 }
 const gradeText=w.state==='RECORDED'&&w.grade?
  'A preliminary NWS Central Park report recorded '+w.grade.observedHighF+'°F. The independent forecast range was '+
  (w.grade.hitIndependentBand?'hit':'missed')+' with '+w.grade.absoluteErrorF+
  '°F absolute error. This does NOT verify any Kalshi contract settlement.':
  'No matching preliminary Central Park result is verified for that forecast in the recent archive window.';
 const scoreText=score?
  'Independent weather research: '+score.evaluatedDays+' distinct graded climate day(s)'+(score.lastDate?' through '+score.lastDate:'')+'.'+
  (score.meanAbsoluteErrorF===null?'':' Mean absolute error '+score.meanAbsoluteErrorF.toFixed(1)+'°F.')+
  (score.independentBandHitRate===null?'':' Experimental 5°F range coverage '+pct(score.independentBandHitRate)+' (not a betting win rate).')+
  ' Previously trained predictions scored: '+score.modelScoredDays+
  (score.modelBrier===null?'; model Brier not yet measurable.':'; model Brier '+score.modelBrier.toFixed(4)+'.')+
  ' No Kalshi market benchmark is available.':
  s.state==='ARCHIVE_UNAVAILABLE'?
   'The archived independent weather scorecard is unavailable or failed verification; no accuracy can be established.':
   'No verified independent weather scorecard has been archived yet; measured accuracy is unavailable.';
 const marketLimit='Kalshi market-data permission and account/contract eligibility are not verified in SportsEdge. This chat makes zero Kalshi API requests. It has no authorized live bid/ask, fills, or official contract results and cannot identify actionable or profitable Kalshi bets.';
 const disclaimer='NOAA weather forecasts and preliminary station observations are independent research, not traded positions, contract settlements or profit.';
 let replyText:string;
 if(q.topic==='controls'){
  replyText='Kalshi trading and API access cannot be started from this chat. Nothing was changed. '+marketLimit;
 }else if(q.topic==='opportunity'||q.topic==='picks'){
  replyText='No verified real Kalshi market opportunity is available from these records. '+marketLimit+'\n\n'+archiveText;
 }else if(q.topic==='performance'||q.topic==='explain'){
  replyText=scoreText+'\n\n'+archiveText+'\n\n'+gradeText+'\n\n'+disclaimer;
 }else if(q.topic==='automation'){
  replyText='The independent NOAA collector has a configured schedule, but scheduled jobs are not proof of a saved record.\n\n'+
   archiveText+'\n\n'+scoreText+'\n\nOpen Weather collector runs for actual run receipts. Exchange data collection is not enabled here.';
 }else{
  replyText='Kalshi independent research (checked '+timestamp(view.checkedAt)+'). No trading.\n\n'+
   archiveText+'\n\n'+gradeText+'\n\n'+scoreText+'\n\n'+marketLimit;
 }
 const facts:Extract<Card,{kind:'facts'}>['items']=[
  {label:'Kalshi exchange data',value:'Not authorized / connected',detail:'No live quotes, fees verified per series or contract settlements'},
  {label:'Actual Kalshi paper fills',value:'None verified',detail:'Synthetic/offline simulator is not a filled trade'},
  {label:'NOAA archive',value:archiveState==='RECORDED'?'Recent forecast recorded':
   archiveState==='ARCHIVE_UNAVAILABLE'?'Unavailable':'Awaiting recent verified forecast'},
  {label:'Weather evidence',value:score?String(score.evaluatedDays)+' climate day(s)':'Unavailable',
   detail:'Independent weather accuracy is not a Kalshi winning-bet rate'}
 ];
 if(w.state==='RECORDED'&&w.memory.estimatedBandProbabilityPpm!==null)
  facts.push({label:'Unvalidated model probability',value:(w.memory.estimatedBandProbabilityPpm/10000).toFixed(1)+'%',
   detail:'Experimental 5°F weather range only, not calibrated market edge'});
 return {text:replyText,cards:[{kind:'facts',items:facts},LINKS],
  suggestions:SUGGEST,context:ctx,private:false};
}
