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
 {label:'All recorded sports predictions',href:'/paper-betting/predictions',purpose:'Candidate-only forecasts as well as recorded paper picks, with grade and calibration evidence',domain:'sports'},
 {label:'NBA model research',href:'/research/nba',purpose:'Historical and forward NBA model evaluation',domain:'sports'},
 {label:'AI Learning Lab',href:'/lab',purpose:'Forecast calibration, model comparisons and shadow challengers',domain:'sports'},
 {label:'Stock PAPER autopilot',href:'/stocks/paper-auto',purpose:'Owner Start/Stop, frozen decisions, PAPER worker evidence and after-close marks',domain:'stocks'},
 {label:'Alpaca PAPER account',href:'/stocks/alpaca',purpose:'Signed-in account balance, positions and broker-side fills',domain:'stocks'},
 {label:'Stock strategy research',href:'/stocks/research',purpose:'Historical/forward studies, benchmark SPY and unpromoted strategies',domain:'research'},
 {label:'Independent Kalshi research',href:'/prediction-markets/kalshi',purpose:'NOAA weather forecasts, preliminary station observations and independent scorecards',domain:'kalshi'},
 {label:'Automation monitor',href:'/automation',purpose:'Collector, scheduler and worker health; job status does not prove an order',domain:'all'},
 {label:'GitHub Actions workflows',href:'https://github.com/ang87505-crypto/SportsEdge/actions',purpose:'Run history and manually dispatched workflows; owner permissions may be needed',domain:'all'},
 {label:'Ask SportsEdge',href:'/assistant',purpose:'This read-only assistant and its supported research topics',domain:'all'}
];
export function isNavigationQuestion(message:string):boolean{
 const s=conversationalText(message);
 // Explicit navigation only: "show me today's trades" requests data,
 // while "show me the trade dashboard" requests a link.
 return /\b(where to (find|see|check|look|go|open)|how to (find|open|get to)|where (can|do|should) i (find|see|check|look|open|go)|where (is|are) (the|my|our) (page|dashboard|report|tab)|where (is|are) (the|my|our) [a-z ]{1,50} (page|dashboard|report|tab)|how (can|do|should) i (find|open|view|access|get to|navigate to)|take me (to|back to)|go to (the|my|our)|open (the|my|our) [a-z ]{1,50} (page|dashboard|tab|screen)|show me (the )?(page|dashboard|screen|tab)|show me (the )?[a-z ]{1,50} (page|dashboard|screen|tab)|send me (the )?link|give me (the )?link|point me to|link (me|to)|which (page|screen|tab|dashboard)|where did (that|this) (number|stat|result|figure) come from)\b/.test(s)||
  /^(?:open|go to|navigate to|visit|take me to) (?:the |my |our )?(?:sports|nba|stock|stocks|alpaca|kalshi|noaa|prediction|predictions|research|backtests?|paper picks|picks|props|automation|workflows?|jobs|dashboard|learning lab|system status)\b/.test(s);
}
function relevant(q:QuestionRoute,s:string):Destination[]{
 const matches=(label:string)=>DESTINATIONS.filter(d=>d.label===label);
 if(/\b(all|every|everything|whole site)\b/.test(s)&&/\b(page|pages|dashboards?|tabs?|screens?)\b/.test(s))
  return ['Sports picks and graded results','All recorded sports predictions','Stock PAPER autopilot',
   'Stock strategy research','Independent Kalshi research','Automation monitor'].flatMap(matches);
 if(/^(?:open|go to|navigate to|visit|take me to) (?:the |my |our )?predictions?\b/.test(s)||
  /\b(candidate|all predictions?|every predictions?|full prediction|prediction list|every line|unrecorded|not paper|every pick|every forecast)\b/.test(s))
  return matches('All recorded sports predictions');
 if(/\b(nba model|elo|basketball model|nba research)\b/.test(s))return matches('NBA model research');
 if(/\b(stock|stocks|strategy|strategies)\b/.test(s)&&/\b(research|backtests?|models?|performance vs spy|lab)\b/.test(s))
  return matches('Stock strategy research');
 if(/\b(learning lab|calibration|brier|model comparisons?|challengers?)\b/.test(s))
  return matches('AI Learning Lab');
 if(/\b(github|actions|workflow runs?|logs?|ci|build checks?)\b/.test(s))
  return matches('GitHub Actions workflows');
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
 if(/\b(props?|picks?|prizepicks|pick6|virtual entries)\b/.test(s))return matches('Sports picks and graded results');
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
 return {text,cards,suggestions:['What can you help me check?','Is anything failing?'],
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
  text:'Do you mean sports picks, stock PAPER results, stock research, Kalshi weather research, or automation? I cannot reliably identify which stored evidence answers that question yet. I can check recorded sports predictions, signed-in stock PAPER results, research reports, independent Kalshi weather observations or automation receipts. Choose a topic or open the relevant page. I will not invent a trade, metric or explanation.',
  cards:[{kind:'links',items:DESTINATIONS.filter(d=>['Sports picks and graded results','All recorded sports predictions','AI Learning Lab','Stock PAPER autopilot','Stock strategy research','Independent Kalshi research','Automation monitor'].includes(d.label)).map(d=>({label:d.label,href:d.href}))}],
  suggestions:['Were today’s stock PAPER trades good?','How did sports picks do yesterday?','Are there Kalshi opportunities?','Is everything running?'],
  context:{domain:q.domain??'all',topic:'help'}
 };
}

/**
 * Source-linked operational guidance. Never initiates scheduling, training,
 * deployment, broker writes, release changes or paid API requests.
 */
export function isManualOperationQuestion(message:string):boolean{
 const s=conversationalText(message);
 // "Did the collector run?" is a read-only status question, not a request to run it.
 return /^(?:(?:please|can you|could you|would you|will you|i want to|i need to|help me|how do i|how can i|how should i) )?(?:run|trigger|dispatch|execute|retrain|backfill|sync|refresh|collect|settle|reconcile|deploy|merge|activate|enable|disable|restart|force|train|pause|stop|resume|start|buy|sell|place|turn on|turn off)\b/.test(s)||
  /\bhow (?:do|can|should) i (?:run|retrain|trigger|dispatch|execute|collect|settle|reconcile|backfill|deploy|activate|enable|disable|pause|stop|resume|start|buy|sell|place)\b/.test(s)||
  /\bwhere (?:do|can|should) i (?:run|retrain|trigger|dispatch|collect|settle|reconcile|pause|stop|resume|start)\b/.test(s);
}
export function manualOperationAnswer(message:string,q:QuestionRoute):Reply{
 const s=conversationalText(message);
 const publicEvent=q.domain==='kalshi'||/\b(kalshi|noaa|nws|bls|cpi|weather|inflation)\b/.test(s);
 const stocks=q.domain==='stocks'||/\b(stocks?|alpaca|autopilot|broker|fills?|portfolio|shares?)\b/.test(s);
 const sports=q.domain==='sports'||/\b(nba|props?|prizepicks|pick6|picks?|box scores?|nfl|nhl|mlb|wnba)\b/.test(s);
 const stockResearch=q.domain==='research'||stocks&&/\b(backtests?|research|retrain|models?|strateg(?:y|ies)|calibrat\w*)\b/.test(s);
 const sportsResearch=sports&&/\b(backtests?|research|retrain|models?|algorithm|calibrat\w*|learning)\b/.test(s);
 const newLeague=/\b(nfl|nhl|mlb|wnba|college football|college basketball)\b/.test(s);
 const deploy=/\b(deploy|merge|pull request|release|production)\b/.test(s);
 const release=/\b(activate|enable|disable|turn on|turn off)\b/.test(s);
 let labels:string[];
 let note:string;
 if(deploy){
  labels=['GitHub Actions workflows','Automation monitor'];
  note='Deployment and merging require a separate code review and release decision. These links do not deploy anything.';
 }else if(publicEvent){
  labels=['Independent Kalshi research','Automation monitor','GitHub Actions workflows'];
  note='NOAA/BLS archive research is separate from Kalshi exchange access; an archive is not a verified tradable opportunity.';
 }else if(newLeague){
  labels=['Sports games','GitHub Actions workflows','Automation monitor'];
  note='Experimental free results archives are not evidence that new-league forecasting or betting is active.';
 }else if(stockResearch){
  labels=['Stock strategy research','Stock PAPER autopilot','Automation monitor'];
  note='Historical research and shadow learning do not enable broker orders or promote a stock strategy.';
 }else if(stocks){
  labels=['Stock PAPER autopilot','Alpaca PAPER account','Automation monitor'];
  note='Stock PAPER account controls require owner sign-in and a separate account preflight. Chat cannot start or submit orders.';
 }else if(sportsResearch){
  labels=['AI Learning Lab','All recorded sports predictions','Sports picks and graded results'];
  note='Learning Lab comparisons are research only; the active NBA props model and virtual stake are unchanged.';
 }else if(sports){
  labels=['Sports picks and graded results','All recorded sports predictions','Automation monitor'];
  note='Collector receipts and virtual entries must be verified; schedules do not imply any picks were placed.';
 }else{
  labels=['Automation monitor','GitHub Actions workflows','Ask SportsEdge'];
  note='Check existing run receipts before concluding a scheduled task succeeded.';
 }
 if(release&&!deploy)note+=' Activation is not performed from this chat.';
 const matches=labels.map(label=>DESTINATIONS.find(d=>d.label===label)).filter((d):d is Destination=>!!d);
 const action=/\b(retrain|train|model|algorithm|learning)\b/.test(s)?'Model training and promotion':
  /\b(deploy|merge|release|activate|enable|disable)\b/.test(s)?'Release or activation':
  /\b(collect|settle|backfill|sync|refresh)\b/.test(s)?'Collection or settlement':
  /\b(reconcile|execute|run|trigger|dispatch|restart)\b/.test(s)?'Workflow or execution':'Operation';
 return {
  text:action+' cannot be performed automatically by asking this chat. Nothing was changed. '+note+
   ' Open a linked page to inspect recorded evidence and any available authorized control; GitHub Actions lists actual workflow runs.',
  cards:[{kind:'links',items:matches.map(x=>({label:x.label,href:x.href}))}],
  suggestions:['Is everything running?','What needs my approval?'],
  context:{domain:q.domain??'all',topic:'automation'}
 };
}
export function supportedCommandsAnswer():Reply{
 return {
  text:'Ask me in ordinary language, even with common typos or short follow-ups. I can read saved sports predictions and virtual results, explain why no picks appeared, check the signed-in stock paper-account status (private details require owner sign-in), summarize public Kalshi/NOAA research, review model evidence, and describe automation health. I can point you to the right page or workflow when a record is unavailable.\n\nFor safety, I cannot place bets, submit stock orders, start stock autopilot, activate collectors, deploy code, or automatically change a model. Pause/Stop and PrizePicks Resume can only be proposed to a signed-in owner and require a separate Confirm.',
  cards:[{kind:'links',items:DESTINATIONS.filter(x=>['Sports picks and graded results','All recorded sports predictions',
   'AI Learning Lab','Stock PAPER autopilot','Independent Kalshi research','Automation monitor'].includes(x.label)).map(x=>({label:x.label,href:x.href}))}],
  suggestions:['Did my picks hit yesterday?','Why no picks tonight?','Were today’s stock trades good?','What did NOAA record?','What needs my approval?','Where are all the dashboards?'],
  context:{domain:'all',topic:'help'}
 };
}
/** New leagues are data research, not proof of live game-forecast or bets coverage. */
export function unsupportedLeagueAnswer(message:string):Reply|null{
 const s=conversationalText(message);
 if(!/\b(nfl|nhl|mlb|wnba|college football|college basketball)\b/.test(s))return null;
 if(!/\b(picks?|bets?|lines?|odds|predictions?|win rate|forecast|results?|accuracy|model|available|supported|tonight)\b/.test(s))return null;
 const league=/(nfl|nhl|mlb|wnba|college football|college basketball)/.exec(s)?.[1]?.toUpperCase()??'that league';
 return {text:'I cannot verify an active '+league+' picks or settled betting ledger from this chat. The current sports-picks answers come from recorded NBA props; a league being considered for independent data research does not mean its prediction model or betting integration is live. Check the Sports and research pages for supported games, or check GitHub for any unmerged research work. I will not invent '+league+' predictions.',
  cards:[{kind:'links',items:[{label:'Sports research',href:'/sports'},{label:'Research workflows and PRs',href:'https://github.com/ang87505-crypto/SportsEdge/pulls'}]}],
  suggestions:['How are NBA picks doing?','Where are all recorded predictions?'],context:{domain:'sports',topic:'help'}};
}

/**
 * Distinguish "why aren't you working?" about the conversational assistant
 * from "is SportsEdge down?" about real collector/server health.
 * A chat availability question never checks private accounts or proposes an action.
 */
export function isAssistantAvailabilityQuestion(message:string):boolean{
 const t=conversationalText(message);
 if(!t||/\b(sportsedge|website|site|server|stocks?|props?|picks?|models?|kalshi|collectors?|workflows?|jobs?|alpaca|nba|nhl|nfl)\b/.test(t))
  return false;
 return /^(?:why (?:are you not|are not you|is (?:the )?(?:assistant|chat) not) (?:working|coding)|why (?:did you )?stop (?:working|coding)|are you (?:still |actually )?(?:working|coding)|are you doing (?:anything|work)|can you (?:still |keep )?(?:working|coding|work|code)|how (?:long|often) (?:do you )?(?:keep|continue) (?:working|coding))\b/.test(t);
}
/** Plain answer with grounded monitoring links, not fabricated live statuses. */
export function assistantAvailabilityAnswer():Reply{
 return {
  text:'I can help when you send a message, but I do not continue editing code or running checks after a chat reply ends. Existing scheduled GitHub Actions can run independently of the chat. That does not mean a particular job actually succeeded. Nothing was started or changed by this question. To see whether SportsEdge collectors or automated jobs ran, open the Automation monitor or GitHub Actions history.',
  cards:[{kind:'links',items:[
   {label:'Automation monitor',href:'/automation'},
   {label:'GitHub Actions history',href:'https://github.com/ang87505-crypto/SportsEdge/actions'}
  ]}],
  suggestions:['Is any automation broken?','What did the system do today?','Where are the workflow logs?'],
  context:{domain:'all',topic:'help'}
 };
}
