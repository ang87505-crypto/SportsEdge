/** Server-side projection: only public dashboard facts cross into the conversation component. */
import {buildView,type Raw} from './dashboard-view.ts';
import {PROPS_RELEASE} from './schedule.ts';
import {propsAutomationStatus} from '../paper-automation-view.ts';
import type {ChatData,ChatPlatform} from './conversation.ts';

export function propsChatData(raw:Raw|null,issue:ChatData['issue']='not_configured',nowIso=new Date().toISOString()):ChatData{
 const views=raw?{prizepicks:buildView(raw,'prizepicks'),pick6:buildView(raw,'pick6')}:null;
 const project=(platform:'prizepicks'|'pick6'):ChatPlatform=>{
  if(!views)return {lines:[],entries:[],account:null,initialCents:null};
  const v=views[platform];
  return {account:v.account?.slug??null,initialCents:v.account?Number(v.account.initial_cents):null,
   lines:v.lines.map(l=>({id:l.id,player:l.player,stat:l.stat,line:l.line,game:l.game,lockAt:l.lockAt,ingestedAt:l.ingestedAt,
    side:l.side,recorded:l.decision==='recorded',probability:l.side==='more'?l.pMore:l.side==='less'?l.pLess:null,mean:l.mean,modelVersion:l.modelVersion,
    result:l.result?{outcome:l.result.outcome,actual:l.result.actual}:null,correct:l.correct,
    books:l.market?{probability:l.market.pMoreBooks,count:l.market.booksAtSameLine,gap:l.market.lineGap,flags:l.market.flags}:null})),
   // Incomplete joins stay incomplete, so they can never be offered as a full lineup.
   entries:v.entries.map(e=>({id:e.id,lockAt:e.lockAt,legIds:e.legs.map(l=>l.id),profitCents:e.settlement?.profitCents??null,settled:e.settlement!==null}))};
 };
 const v=views?.prizepicks??null;
 const status=raw?propsAutomationStatus(raw,PROPS_RELEASE.scheduledRunsEnabled):null;
 return {asOf:raw?.nowIso??nowIso,issue:raw?null:issue,platforms:{prizepicks:project('prizepicks'),pick6:project('pick6')},
  scheduleEnabled:PROPS_RELEASE.scheduledRunsEnabled,control:raw?.control?{state:raw.control.state,reason:raw.control.reason}:null,
  status:status?`${status.label}. ${status.explanation} ${status.nextAction}`:null,
  model:v?.model?{active:v.model.active,learningEnabled:v.model.learningEnabled,autoSwitchEnabled:v.model.autoSwitchEnabled,
   challengers:v.model.challengers.map(c=>({version:c.version,state:c.state,gradedLines:c.gradedLines}))}:null};
}
