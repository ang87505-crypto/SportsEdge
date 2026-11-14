/** Routes domains before any sports player matching or data access. */
import type {AssistantContext} from './understand.ts';
import {conversationalText} from './colloquial.ts';
import type {ResearchId} from '../research/stock-summary.ts';
import {labTopic} from './lab-answer.ts';
export type AssistantDomain='sports'|'stocks'|'research'|'kalshi'|'all';
export type AssistantTopic='overview'|'performance'|'holdings'|'picks'|'automation'|'explain'|'controls'|'help'|'approvals'|'jobs'|
 'today'|'money'|'health'|'improving'|'opportunity'|'ready'|'lab';
export type QuestionRoute={domain:AssistantDomain|null;topic:AssistantTopic;symbol?:string;strategyId?:ResearchId};
export function routeQuestion(message:string,previous:AssistantContext|null):QuestionRoute{
 const t=conversationalText(message);
 // AI Learning Lab and staking questions are answered from the lab reports and saved records, before any other route.
 // Kalshi forecasting/calibration questions must not accidentally invoke the sports props lab.
 const kalshi=/\b(kalshi|prediction markets?|event contracts?|noaa|nws|central park|weather (?:research|forecasts?|model|accuracy|predictions?)|inflation|cpi|bls)\b/.test(t);
 if(!kalshi&&labTopic(message))return {domain:'all',topic:'lab'};
 const sports=/\b(sports?|nba|soccer|prizepicks|prize picks|pick6|pick 6|bets?|betting|lineups?|props?|tonight|points?|rebounds?|assists?|jokic|jokc|booker|picks|entries|entry|odds api|credits?|qualif\w*|virtual entr\w*|line collection|next collection)\b/.test(t);
 const stocks=/\b(stocks?|portfolio|alpaca|shares?|equity|autopilot|trades?|traded|oxy|altria|usb|bmy|csx|holdings|positions?|buying power|paper trading|orders?|fills?)\b/.test(t);
 const research=/\b(qmom|berkshire|buffett|momentum|research|backtest|strategies|strategy|benchmark|spy|challengers?|daily trading|day trading|trading every day|daily strateg\w*)\b/.test(t)||
  (stocks&&/\b(algorithm|model|learning|learn)\b/.test(t));
 const general=/\b(both|everything|all systems|whole site|site status|background jobs?|jobs?|workers?|monitor|github actions|cron|workflows?|approvals?|approve)\b/.test(t);
 // Operations questions ("what failed", "what needs my approval") are answered from the monitor alone.
 const ops=/\b(approvals?|approve|sign off)\b|needs? (me|my)|requires? (me|my)/.test(t)?'approvals':
  /\b(workflows?|github actions)\b/.test(t)&&!sports&&!stocks?'jobs':null;
 // Generic words such as 'bets', 'odds', 'picks' and 'jobs' are NOT a sports
 // signal when Kalshi is explicitly named; retain a mixed domain only if the
 // user also names NBA/soccer/PrizePicks/stocks or explicitly asks about all systems.
 const explicitSports=/\b(nba|soccer|prizepicks|prize picks|pick6|pick 6|sports|player props|jokic|booker)\b/.test(t);
 const explicitWholeSite=/\b(all systems|whole site|everything|across all)\b/.test(t);
 let domain:QuestionRoute['domain']=kalshi?(explicitSports||stocks||explicitWholeSite?'all':'kalshi'):
  sports&&(stocks||research)||general?'all':research?'research':stocks?'stocks':sports?'sports':null;
 const follow=/^(why|and|also|what about|how about|explain|is it|did it|does it|does that|is that|when|how much|how accurate|how good|how are|how can|how do|what should|what can|what does that mean|what changed|what is next|what happened|how did|show me)\b/.test(t)||
  /^(results|performance|profit|status|picks|holdings|yes|more)$/.test(t);
 if(!domain&&follow)domain=previous?.domain??null;
 let topic:AssistantTopic='overview';
 if(/^(please )?(buy|sell|place|pause|resume|stop|start)\b|\b(can you|could you) (buy|sell|place|pause|resume|stop|start)\b/.test(t))topic='controls';
 else if(/\b(improv\w*|get better|do better|make .* better|next steps?|what should we fix)\b/.test(t))topic='improving';
 else if(/\b(why|explain|learn|learning|changed)\b/.test(t))topic='explain';
 else if(/\b(hold|holds|holding|holdings|positions?|shares|own|portfolio)\b/.test(t))topic='holdings';
 else if(/\b(profit|returns?|pnl|p l|results?|perform|performance|doing|compare|beat|money|lost|balance|accuracy|accurate|hit rate|brier|calibrat\w*|good|worthwhile|decent)\b|how did|are we up|am i up/.test(t))topic='performance';
 else if(/\b(running|status|schedule|scheduled|next|automation|workflow|collect|collection|enabled|paused|blocked|failed|working|refresh|updated|update|snapshot|captured)\b/.test(t))topic='automation';
 else if(/\b(picks|picked|bought|targets)\b/.test(t))topic='picks';
 if(kalshi&&domain==='kalshi'&&/\b(opportunit\w*|edge|best (current )?(bet|market)|profitable|value)\b/.test(t))topic='opportunity';
 if(topic==='improving'&&domain===null)domain=previous?.domain??'all';
 if(ops&&!kalshi){domain='all';topic=ops;}
 // Whole-site questions answered from the shared briefing (the same read model as the Overview page).
 else if(topic!=='controls'){
  const brief:AssistantTopic|null=
   /\bready\b.*\b(monday|first (stock )?session|stock session)\b|\b(monday|first session)\b.*\bready\b/.test(t)?'ready':
   /\bwhat happened\b|\bwhat (did|has) (we|you|it|sportsedge) (do|done)\b|\bcatch me up\b|\bbrief me\b|\b(daily|today is) (summary|briefing|brief)\b|\bso far today\b|^how did (we|it|things) (do|go)( today)?$/.test(t)?'today':
   /\bbroken\b|\b(anything|something) (wrong|failing|failed|broken)\b|\bis (everything|anything|the site|automation|it all) (ok|okay|working|running|fine|healthy)\b|\bany (automation|jobs?) (broken|failing|failed|down)\b/.test(t)?'health':
   /\bpromising\b|\bopportunit\w*|\bbest (current )?(bet|play|idea)\b/.test(t)&&domain!=='stocks'&&domain!=='kalshi'?'opportunity':
   (!kalshi&&(!domain||domain==='all'))&&(/\b(algorithm|model|models|system|ai)\b.*\b(improv\w*|learn\w*|better|progress\w*)\b/.test(t)||/\b(improving|getting better)\b/.test(t))?'improving':
   !domain&&/\b(money|made|make|earn\w*|profit\w*|pnl|p l|up or down|losing|lost)\b/.test(t)?'money':null;
  if(brief){
   // A specific sports/stock/Kalshi improvement follow-up stays in that
   // domain; unqualified whole-site progress requests use the full briefing.
   if(brief!=='improving'||!domain)domain='all';
   topic=brief;
  }
  else if(!domain&&/\bmistakes?\b|\bwent wrong\b|\bwhy (are|do|did) we (keep )?los/.test(t))domain='sports';
 }
 if(!t||/^(help|hi|hello|hey|what can you do)$/.test(t)){domain='all';topic='help';}
 if(topic==='overview'&&follow&&domain===previous?.domain&&previous?.topic)topic=previous.topic;
 // A past-domain follow-up like 'and yesterday?' must retain the original
 // performance topic without inventing a new trade from the message.
 if(topic==='overview'&&domain===previous?.domain&&follow&&previous?.topic==='performance')topic='performance';
 let strategyId:ResearchId|undefined;
 if(/\b(qmom|fund follower)\b/.test(t))strategyId='qmom-disclosure-follower-v1';
 else if(/\b(berkshire|buffett|13f)\b/.test(t))strategyId='berkshire-13f-top5-paper-v1';
 else if(/\b(momentum|quality)\b/.test(t))strategyId='momentum-quality-paper-v1';
 else if(domain===previous?.domain&&follow)strategyId=previous?.strategyId;
 const ignore=new Set(['I','A','IS','HOW','WHAT','WHY','MY','THE','AND','DO','ARE','CAN','SPY','QMOM','NBA','PAPER']);
 const symbol=message.match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g)?.find(s=>!ignore.has(s))??
  (follow&&domain===previous?.domain?previous?.symbol:undefined);
 return {domain,topic,symbol,strategyId};
}
