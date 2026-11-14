/**
 * Citable-in-app navigation for questions we cannot infer from a ledger.
 * Pages are real SportsEdge routes; nothing here fetches private records,
 * changes a release switch or invents a result.
 */
import type {Reply,Card} from './answer.ts';
import type {QuestionRoute,AssistantDomain} from './domain.ts';
import {conversationalText} from './colloquial.ts';

type Destination={label:string;href:string;purpose:string;domain:AssistantDomain};
const DESTINATIONS:readonly Destination[]=[
 {label:'Sports picks and graded results',href:'/paper-betting/props',purpose:'Recorded picks, entries, grading and virtual results',domain:'sports'},
 {label:'Sports games',href:'/sports',purpose:'NBA and soccer game research',domain:'sports'},
 {label:'AI Learning Lab',href:'/lab',purpose:'Forecast calibration, model comparisons and shadow challengers',domain:'sports'},
 {label:'Stock PAPER autopilot',href:'/stocks/paper-auto',purpose:'Owner Start/Stop, frozen decisions, PAPER worker evidence and after-close marks',domain:'stocks'},
 {label:'Alpaca PAPER account',href:'/stocks/alpaca',purpose:'Signed-in account balance, positions and broker-side fills',domain:'stocks'},
 {label:'Stock strategy research',href:'/stocks/research',purpose:'Historical/forward studies, benchmark SPY and unpromoted strategies',domain:'research'},
 {label:'Independent Kalshi research',href:'/prediction-markets/kalshi',purpose:'NOAA weather forecasts, preliminary station observations and independent scorecards',domain:'kalshi'},
 {label:'Automation monitor',href:'/automation',purpose:'Collector, scheduler and worker health; job status does not prove an order',domain:'all'},
 {label:'Ask SportsEdge',href:'/assistant',purpose:'This read-only assistant and its supported research topics',domain:'all'}
];
export function isNavigationQuestion(message:string):boolean{
 const s=conversationalText(message);
 return /\b(where (can|do|should) i (find|see|check|look|open)|where (is|are) (the|my) (page|dashboard|report)|where (is|are) (the|my) [a-z ]{1,40} (page|dashboard|report)|how (can|do) i (find|open|view)|take me to|show me (the )?(page|dashboard|screen)|show me (the )?[a-z ]{1,40} (page|dashboard|screen)|link (me|to)|which page|where did (that|this) (number|stat|result|figure) come from)\b/.test(s);
}
function relevant(q:QuestionRoute,s:string):Destination[]{
 const matches=(label:string)=>DESTINATIONS.filter(d=>d.label===label);
 if(/\b(kalshi|noaa|nws|weather|inflation|cpi)\b/.test(s))return matches('Independent Kalshi research');
 if(/\b(monitor|automation|workflow|scheduled|cron|collector|jobs|run receipts)\b/.test(s))
  return matches('Automation monitor');
 if(/\b(stock|alpaca|paper order|portfolio|holdings|fills|trades?)\b/.test(s)){
  return /\b(positions?|balance|fill|fills|filled|broker|alpaca)\b/.test(s)?
   matches('Alpaca PAPER account'):matches('Stock PAPER autopilot');
 }
 if(/\b(calibrat|learning lab|improv|model|predict|backtest)\b/.test(s)){
  if(q.domain==='stocks'||q.domain==='research')return matches('Stock strategy research');
  if(q.domain==='kalshi')return matches('Independent Kalshi research');
  return matches('AI Learning Lab');
 }
 if(/\b(sports|nba|soccer|odds)\b/.test(s))return matches('Sports games');
 if(/\b(picks|props|prizepicks|results|bets|entries)\b/.test(s))return matches('Sports picks and graded results');
 if(q.domain==='stocks')return [matches('Stock PAPER autopilot')[0],matches('Alpaca PAPER account')[0]];
 if(q.domain==='research')return matches('Stock strategy research');
 if(q.domain==='kalshi')return matches('Independent Kalshi research');
 if(q.domain==='sports')return matches('Sports picks and graded results');
 return [matches('Ask SportsEdge')[0],matches('Automation monitor')[0]];
}
export function navigationAnswer(message:string,q:QuestionRoute):Reply{
 const choices=relevant(q,conversationalText(message));
 const cards:Card[]=[{kind:'links',items:choices.map(x=>({label:x.label,href:x.href}))}];
 const text=choices.map(x=>x.label+': '+x.purpose+'.').join('\n')+
  '\n\nThese pages show recorded evidence where available. Missing or stale records do not mean zero trades, zero profit or a failed model. Private Alpaca information requires owner sign-in.';
 return {text,cards,suggestions:choices.map(x=>'Open '+x.label).slice(0,4),
  context:{domain:q.domain??'all',topic:q.topic}};
}
/** Domain-aware next steps, not invented analysis or an action to retrain. */
export function improvementAnswer(q:QuestionRoute):Reply{
 const domain=q.domain;
 const guides:Record<string,{body:string;links:{label:string;href:string}[];suggestions:string[]}>={
  sports:{
   body:'To improve sports predictions safely, compare frozen predictions against later graded outcomes, look for overconfidence by probability band and player/game, test minutes and rate assumptions, and compare a challenger on future games. No production model or PAPER staking rules are changed by asking.',
   links:[{label:'AI Learning Lab',href:'/lab'},{label:'Recorded sports picks',href:'/paper-betting/props'}],
   suggestions:['Which features actually improve our predictions?','How accurate are the 80% predictions?','What mistakes are repeated?']
  },
  stocks:{
   body:'To improve stock decisions, first verify actual PAPER fills, cash-reconciled after-close marks and SPY-relative results. Then run a separate shadow strategy using only data available before each decision. A single day, planned order or winning position does not prove an edge. Your current trading strategy remains frozen.',
   links:[{label:'Stock PAPER autopilot',href:'/stocks/paper-auto'},{label:'Stock research',href:'/stocks/research'}],
   suggestions:['Were today’s stock PAPER trades good?','Which strategy beat SPY?','Is stock autopilot ready?']
  },
  research:{
   body:'To improve research, check the registered baselines, costs, drawdown, sample size and genuine forward results. Examine which pre-registered failure gates are blocking promotion, then test alternatives in shadow mode. Do not adjust live models based on one favorable backtest.',
   links:[{label:'Stock strategy research',href:'/stocks/research'},{label:'AI Learning Lab',href:'/lab'}],
   suggestions:['Which stock strategy beat SPY?','Which model is most accurate?','Are forward tests sufficient?']
  },
  kalshi:{
   body:'For independent Kalshi research, first verify NOAA archived forecasts and later preliminary station results. Track prediction error and probability calibration across dates. Only then assess exact market rules, authorized current prices, fees and liquidity; no real Kalshi opportunity or profit can be claimed without that evidence. Exchange access is not enabled by chat.',
   links:[{label:'Independent Kalshi research',href:'/prediction-markets/kalshi'},
    {label:'NOAA collection runs',href:'https://github.com/ang87505-crypto/SportsEdge/actions/workflows/kalshi-independent-weather-memory.yml'}],
   suggestions:['Is NOAA collecting?','How accurate is Kalshi weather research?','Are real Kalshi opportunities available?']
  }
 };
 const g=guides[domain??'']??null;
 if(!g)return {text:'Improvement depends on which system you mean. Sports props, stock PAPER trading, stock research and independent Kalshi forecasts have different outcomes and learning rules. Select one so I can use the right evidence.',
  cards:[{kind:'links',items:DESTINATIONS.filter(d=>['sports','stocks','research','kalshi'].includes(d.domain)).map(d=>({label:d.label,href:d.href})).slice(0,6)}],
  suggestions:['How can we improve sports picks?','How can we improve stock PAPER trading?','How can we improve Kalshi weather forecasts?'],
  context:{domain:'all',topic:'improving'}};
 return {text:g.body,cards:[{kind:'links',items:g.links}],suggestions:g.suggestions,
  context:{domain:domain??'all',topic:'improving'}};
}
export function unsupportedQuestion(q:QuestionRoute):Reply{
 return {
  text:'I cannot reliably identify which stored evidence answers that question yet. I can check recorded sports predictions, signed-in stock PAPER results, research reports, independent Kalshi weather observations or automation receipts. Choose a topic or open the relevant page. I will not invent a trade, metric or explanation.',
  cards:[{kind:'links',items:DESTINATIONS.filter(d=>d.domain!=='all').map(d=>({label:d.label,href:d.href})).slice(0,7)}],
  suggestions:['Were today’s stock PAPER trades good?','How did sports picks do yesterday?','Are there Kalshi opportunities?','Is everything running?'],
  context:{domain:q.domain??'all',topic:'help'}
 };
}
