/**
 * Owner control requests made in chat. Chat never executes anything: it can only PROPOSE one of these allowlisted
 * actions to a signed-in owner. The confirm button in the chat UI sends the fixed request below to the SAME owner
 * endpoint the control pages use. That endpoint re-checks the owner session, validates the action and writes its
 * own durable record (props control history; stock gate events). Start/arming, resume of stock orders, order
 * placement, budgets and model promotion are never available from chat.
 */
export type ChatActionId='props-pause'|'props-resume'|'props-stop'|'stock-pause'|'stock-stop';
export type ChatAction={target:'props'|'stocks';label:string;effect:string;to:'RUNNING'|'PAUSED'|'STOPPED';
 endpoint:'/api/internal/props/control'|'/api/internal/paper-auto';body:(experimentId?:string)=>Record<string,string>};
const EXPERIMENT=/^[a-z0-9][a-z0-9-]{2,62}$/;
export const CHAT_ACTIONS:Record<ChatActionId,ChatAction>={
 'props-pause':{target:'props',to:'PAUSED',label:'Pause PrizePicks paper picks',endpoint:'/api/internal/props/control',
  effect:'Capture checks, picks and grading stop until you resume. Saved picks, entries and results are kept. No credits are spent while paused.',
  body:()=>({action:'pause',reason:'Paused from Ask SportsEdge'})},
 'props-resume':{target:'props',to:'RUNNING',label:'Resume PrizePicks paper picks',endpoint:'/api/internal/props/control',
  effect:'Scheduled capture checks, picks and grading run again under the same credit limits (7 per day, 200 per 30 days).',
  body:()=>({action:'resume',reason:'Resumed from Ask SportsEdge'})},
 'props-stop':{target:'props',to:'STOPPED',label:'Stop PrizePicks paper picks',endpoint:'/api/internal/props/control',
  effect:'Nothing runs until you resume. Saved results are kept.',
  body:()=>({action:'stop',reason:'Stopped from Ask SportsEdge'})},
 'stock-pause':{target:'stocks',to:'PAUSED',label:'Pause the stock PAPER autopilot',endpoint:'/api/internal/paper-auto',
  effect:'No new paper orders. To switch it back on, press Start on the Autopilot page (it re-checks the account first).',
  body:(id)=>({action:'pause',experimentId:id!})},
 'stock-stop':{target:'stocks',to:'STOPPED',label:'Stop the stock PAPER autopilot',endpoint:'/api/internal/paper-auto',
  effect:'The autopilot switches off and records an owner stop. To switch it back on, press Start on the Autopilot page (it re-checks the account first).',
  body:(id)=>({action:'stop',experimentId:id!})},
};
export const isChatActionId=(v:unknown):v is ChatActionId=>typeof v==='string'&&Object.hasOwn(CHAT_ACTIONS,v);
/** The exact request the confirm button sends; null for anything outside the allowlist. */
export function chatActionRequest(id:unknown,experimentId?:unknown):{endpoint:string;body:Record<string,string>}|null{
 if(!isChatActionId(id))return null;
 const a=CHAT_ACTIONS[id];
 if(a.target==='stocks'&&(typeof experimentId!=='string'||!EXPERIMENT.test(experimentId)))return null;
 return {endpoint:a.endpoint,body:a.body(experimentId as string|undefined)};
}

export type ControlRequest={verb:'pause'|'resume'|'stop'|'start'|'trade';target:'props'|'stocks'|null};
/** "pause the props", "stop autopilot", "resume picks", "start the stock bot", "buy OXY". */
export function parseControlRequest(text:string):ControlRequest|null{
 const t=text.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
 const m=/\b(pause|resume|unpause|stop|halt|start|turn (?:off|on)|switch (?:off|on)|buy|sell|place)\b/.exec(t);
 if(!m)return null;
 const w=m[1];
 const verb:ControlRequest['verb']=/buy|sell|place/.test(w)?'trade':/pause/.test(w)&&w!=='unpause'?'pause':/resume|unpause|turn on|switch on/.test(w)?'resume':/stop|halt|turn off|switch off/.test(w)?'stop':'start';
 const props=/\b(props?|picks?|prizepicks|prize picks|pick6|sports?|nba|collection|betting)\b/.test(t);
 const stocks=/\b(stocks?|autopilot|alpaca|stock bot|trading|orders?|portfolio)\b/.test(t);
 return {verb,target:props&&!stocks?'props':stocks&&!props?'stocks':null};
}
