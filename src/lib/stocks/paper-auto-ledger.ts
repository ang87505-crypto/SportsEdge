/**
 * Strict reader for the recurring PAPER dashboard read model (sportsedge_paper_auto_ledger).
 * Shared by the owner API route and the page. Unknown keys are dropped; any malformed
 * field makes the whole ledger unavailable (fail closed). Pure; no network.
 */
import {parseDailyMarks,type DailyMark} from './paper-auto-performance.ts';

export const OPERATOR_STATES=['STOPPED','PAUSED','READY','BLOCKED','EXECUTING'] as const;
export type OperatorState=typeof OPERATOR_STATES[number];
export type PaperAutoStatus={experimentId:string;state:OperatorState;gateMode:'STOPPED'|'PAUSED'|'ARMED';
 gateReason:string;gateVersion:number;gateChangedAt:string;gateChangedBy:string;lastCheckAt:string|null;
 lastCheckOk:boolean|null;lastCheckBlockers:string[];lastSuccessAt:string|null;executingRunId:string|null;
 leaseExpiresAt:string|null;unresolvedIntents:number;activeIntents:number;unacknowledgedCriticalAlerts:number;
 modelVersion:string;decisionWindow:{start:string;end:string};limits:Record<string,number>;checkedAt:string};
export type PaperAutoLedger={experimentId:string;registered:true;status:PaperAutoStatus;
 experiment:{registeredAt:string;startingEquityCents:number;brokerAccountNumberSuffix:string;configDigest:string};
 decisions:Array<{decisionId:string;session:string;decisionAt:string;outcome:string;targets:string[];
  reasons:string[];recordedAt:string}>;
 intents:Array<{intentId:string;symbol:string;side:'buy'|'sell';phase:string;attempt:number;shares:number;
  limitCents:number;status:string;brokerStatus:string|null;filledQty:string;filledAvgPrice:string|null;
  createdAt:string;updatedAt:string}>;
 daily:DailyMark[];
 alerts:Array<{alertId:number;severity:'info'|'warning'|'critical';code:string;createdAt:string;
  acknowledgedAt:string|null}>;
 runs:Array<{runId:string;kind:string;slot:string;attempt:number;status:string;startedAt:string;
  finishedAt:string|null;summary:string|null}>;
 gateEvents:Array<{fromMode:string;toMode:string;reason:string;actor:string;at:string}>;
 activityCounts:Record<string,number>};
export type UnregisteredLedger={experimentId:string;registered:false};

const EXPERIMENT=/^[a-z0-9][a-z0-9-]{2,62}$/;
const CODE=/^[A-Z0-9_]{3,64}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
type Obj=Record<string,unknown>;
class Bad extends Error{}
const fail=():never=>{throw new Bad();};
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:fail();
const arr=(v:unknown,max:number):unknown[]=>Array.isArray(v)&&v.length<=max?v:fail();
const str=(v:unknown,re:RegExp):string=>typeof v==='string'&&v.length<=256&&re.test(v)?v:fail();
const text=(v:unknown,max:number):string=>typeof v==='string'&&v.length<=max?v:fail();
const time=(v:unknown):string=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:fail();
const maybe=<T>(v:unknown,f:(x:unknown)=>T):T|null=>v===null||v===undefined?null:f(v);
const int=(v:unknown,lo=0):number=>Number.isSafeInteger(v)&&(v as number)>=lo?v as number:fail();
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail();
const oneOf=<T extends string>(v:unknown,options:readonly T[]):T=>options.includes(v as T)?v as T:fail();

function status(v:unknown):PaperAutoStatus{
 const x=obj(v);
 if(x.realMoneyEnabled!==false||x.brokerEnvironment!=='alpaca-paper')fail();
 const w=obj(x.decisionWindow),limits=obj(x.limits);
 return {experimentId:str(x.experimentId,EXPERIMENT),state:oneOf(x.state,OPERATOR_STATES),
  gateMode:oneOf(x.gateMode,['STOPPED','PAUSED','ARMED'] as const),gateReason:str(x.gateReason,CODE),
  gateVersion:int(x.gateVersion,1),gateChangedAt:time(x.gateChangedAt),
  gateChangedBy:str(x.gateChangedBy,/^(owner|worker:[A-Za-z0-9:_./-]{1,100})$/),
  lastCheckAt:maybe(x.lastCheckAt,time),lastCheckOk:maybe(x.lastCheckOk,bool),
  lastCheckBlockers:arr(x.lastCheckBlockers,50).map(b=>text(b,120)),lastSuccessAt:maybe(x.lastSuccessAt,time),
  executingRunId:maybe(x.executingRunId,s=>str(s,/^run-[a-f0-9]{32}$/)),leaseExpiresAt:maybe(x.leaseExpiresAt,time),
  unresolvedIntents:int(x.unresolvedIntents),activeIntents:int(x.activeIntents),
  unacknowledgedCriticalAlerts:int(x.unacknowledgedCriticalAlerts),
  modelVersion:str(x.modelVersion,/^stock-mom252-skip21-trend200-(v1|holdrank10-v1)$/),
  decisionWindow:{start:str(w.start,DAY),end:str(w.end,DAY)},
  limits:Object.fromEntries(['capitalLimitCents','maxOrderNotionalCents','maxDailyNotionalCents','maxOrdersPerDay',
   'maxOpenOrders','maxAttemptsPerLeg','drawdownStopBps','feeReserveCents'].map(k=>[k,int(limits[k])])),
  checkedAt:time(x.checkedAt)};
}
function reasonsOf(v:unknown):string[]{
 if(!v||typeof v!=='object'||Array.isArray(v))return [];
 const d=v as Obj;
 const list=Array.isArray(d.reasons)?d.reasons:typeof d.reason==='string'?[d.reason]:[];
 return list.slice(0,20).filter((r):r is string=>typeof r==='string').map(r=>r.slice(0,240));
}

/** The operator status alone, e.g. from an owner action reply. */
export function parseStatus(raw:unknown):PaperAutoStatus|null{
 try{return status(raw);}catch(e){if(e instanceof Bad)return null;throw e;}
}
export function parseLedger(raw:unknown):PaperAutoLedger|UnregisteredLedger|null{
 try{
  const x=obj(raw);
  if(x.state==='NOT_REGISTERED')return {experimentId:str(x.experimentId,EXPERIMENT),registered:false};
  const s=status(x.status),e=obj(x.experiment);
  const daily=parseDailyMarks(x.daily)??fail();
  return {experimentId:s.experimentId,registered:true,status:s,
   experiment:{registeredAt:time(e.registeredAt),startingEquityCents:int(e.startingEquityCents,1),
    brokerAccountNumberSuffix:str(e.brokerAccountNumberSuffix,/^[A-Z0-9]{1,4}$/),
    configDigest:str(e.configDigest,/^[a-f0-9]{64}$/)},
   decisions:arr(x.decisions,36).map(v=>{const d=obj(v);return {decisionId:str(d.decisionId,/^[a-f0-9]{64}$/),
    session:str(d.session,DAY),decisionAt:time(d.decisionAt),
    outcome:oneOf(d.outcome,['TARGETS','HOLD_NO_TARGETS','MISSED','INPUT_REJECTED'] as const),
    targets:arr(d.targets,50).map(t=>str(obj(t).symbol,/^[A-Z][A-Z0-9.-]{0,9}$/)),
    reasons:reasonsOf(d.diagnostics),recordedAt:time(d.recordedAt)};}),
   intents:arr(x.intents,200).map(v=>{const i=obj(v);return {intentId:str(i.intentId,/^pai-[a-f0-9]{32}$/),
    symbol:str(i.symbol,/^[A-Z][A-Z0-9.-]{0,9}$/),side:oneOf(i.side,['buy','sell'] as const),
    phase:oneOf(i.phase,['SELL','BUY'] as const),attempt:int(i.attempt,1),shares:int(i.shares,1),
    limitCents:int(i.limitCents,1),status:str(i.status,/^[a-z_]{3,20}$/),
    brokerStatus:maybe(i.brokerStatus,b=>str(b,/^[a-z_]{2,40}$/)),filledQty:str(i.filledQty,/^\d{1,10}(\.\d{1,9})?$/),
    filledAvgPrice:maybe(i.filledAvgPrice,p=>str(p,/^\d{1,10}(\.\d{1,6})?$/)),createdAt:time(i.createdAt),
    updatedAt:time(i.updatedAt)};}),
   daily,
   alerts:arr(x.alerts,50).map(v=>{const a=obj(v);return {alertId:int(a.alertId,1),
    severity:oneOf(a.severity,['info','warning','critical'] as const),code:str(a.code,CODE),
    createdAt:time(a.createdAt),acknowledgedAt:maybe(a.acknowledgedAt,time)};}),
   runs:arr(x.runs,60).map(v=>{const r=obj(v);return {runId:str(r.runId,/^run-[a-f0-9]{32}$/),
    kind:oneOf(r.kind,['decision','execute','monitor','reconcile'] as const),
    slot:str(r.slot,/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}Z)?$/),attempt:int(r.attempt,1),
    status:oneOf(r.status,['running','succeeded','blocked','failed','abandoned'] as const),
    startedAt:time(r.startedAt),finishedAt:maybe(r.finishedAt,time),summary:maybe(r.summary,s=>text(s,120))};}),
   gateEvents:arr(x.gateEvents,50).map(v=>{const g=obj(v);return {fromMode:str(g.fromMode,/^[A-Z]{4,8}$/),
    toMode:str(g.toMode,/^[A-Z]{4,8}$/),reason:str(g.reason,CODE),
    actor:str(g.actor,/^(owner|worker:[A-Za-z0-9:_./-]{1,100})$/),at:time(g.at)};}),
   activityCounts:Object.fromEntries(Object.entries(obj(x.activityCounts)).map(([k,n])=>
    [oneOf(k,['strategy_fill','external_fill','external_cashflow','dividend','fee','corporate_action','other'] as const),
     int(n)]))};
 }catch(e){if(e instanceof Bad)return null;throw e;}
}

/** The newest succeeded, clean reconcile run that RESUME would accept (within 15 minutes, after the gate change). */
export function resumeCandidate(l:PaperAutoLedger,nowMs:number):{runId:string;finishedAt:string}|null{
 const changed=Date.parse(l.status.gateChangedAt);
 const r=l.runs.find(x=>x.kind==='reconcile'&&x.status==='succeeded'&&x.summary==='CLEAN'&&x.finishedAt!==null&&
  Date.parse(x.finishedAt)>changed&&Date.parse(x.finishedAt)>=nowMs-15*60_000);
 return r&&r.finishedAt?{runId:r.runId,finishedAt:r.finishedAt}:null;
}
