/** Routes domains before any sports player matching or data access. */
import {normalize,type AssistantContext} from './understand.ts';
import type {ResearchId} from '../research/stock-summary.ts';
export type AssistantDomain='sports'|'stocks'|'research'|'all';
export type AssistantTopic='overview'|'performance'|'holdings'|'picks'|'automation'|'explain'|'controls'|'help';
export type QuestionRoute={domain:AssistantDomain|null;topic:AssistantTopic;symbol?:string;strategyId?:ResearchId};
export function routeQuestion(message:string,previous:AssistantContext|null):QuestionRoute{
 const t=normalize(message);
 const sports=/\b(sports?|nba|soccer|prizepicks|prize picks|pick6|pick 6|bets?|betting|lineups?|props?|tonight|points?|rebounds?|assists?|jokic|jokc|booker)\b/.test(t);
 const stocks=/\b(stocks?|portfolio|alpaca|shares?|equity|autopilot|oxy|altria|usb|bmy|csx)\b/.test(t);
 const research=/\b(qmom|berkshire|buffett|momentum|research|backtest|strategies|strategy|benchmark|spy|challengers?)\b/.test(t)||
  (stocks&&/\b(algorithm|model|learning|learn)\b/.test(t));
 const general=/\b(both|everything|all systems|whole site|site status)\b/.test(t);
 let domain:QuestionRoute['domain']=sports&&(stocks||research)||general?'all':research?'research':stocks?'stocks':sports?'sports':null;
 const follow=/^(why|and|also|what about|how about|explain|is it|did it|when|how much|what changed|what is next|what happened|how did|show me)\b/.test(t)||
  /^(results|performance|profit|status|picks|holdings|yes|more)$/.test(t);
 if(!domain&&(follow||previous?.domain==='sports'))domain=previous?.domain??null;
 let topic:AssistantTopic='overview';
 if(/^(please )?(buy|sell|place|pause|resume|stop|start)\b|\b(can you|could you) (buy|sell|place|pause|resume|stop|start)\b/.test(t))topic='controls';
 else if(/\b(why|explain|learn|learning|improving|improve|better|changed)\b/.test(t))topic='explain';
 else if(/\b(hold|holds|holding|holdings|positions?|shares|own|portfolio)\b/.test(t))topic='holdings';
 else if(/\b(profit|returns?|pnl|p l|results?|perform|performance|doing|compare|beat|money|lost|balance)\b|how did|are we up|am i up/.test(t))topic='performance';
 else if(/\b(running|status|schedule|scheduled|next|automation|workflow|collect|collection|enabled|paused|blocked|failed|working)\b/.test(t))topic='automation';
 else if(/\b(picks|picked|bought|targets)\b/.test(t))topic='picks';
 if(!t||/^(help|hi|hello|hey|what can you do)$/.test(t)){domain='all';topic='help';}
 if(topic==='overview'&&follow&&domain===previous?.domain&&previous?.topic)topic=previous.topic;
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
