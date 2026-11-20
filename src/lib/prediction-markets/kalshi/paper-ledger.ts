/**
 * Offline fixture ledger. No network, credentials, database or exchange orders.
 * Allocations and returns are hypothetical; they are never observed demo/live fills.
 * Production persistence must supply its own authorization, transaction and receipt clock.
 */
import {canonicalJson,sha256} from '../../props/normalize.ts';
import {freezePaperForecast,gradePaperForecast,type ForecastInput,type OfficialResult,
 type PaperForecast,type PaperGrade} from './paper.ts';

export const PAPER_LEDGER_VERSION='kalshi-offline-paper-ledger-v1' as const;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_EVENTS=10_000;
export type PaperLedgerConfig={
 id:string;mode:'OFFLINE_FIXTURE';initialBalanceMicros:number;
 maxPositionCostMicros:number;maxOpenCostMicros:number;maxOpenPositions:number;
};
export type LedgerForecastInput=Omit<ForecastInput,'predictedAt'>;
export type PaperLedgerPayload=
 |{type:'register';config:PaperLedgerConfig}
 |{type:'control';paused:boolean;reason:string}
 |{type:'forecast';input:LedgerForecastInput}
 |{type:'settlement';forecastId:string;official:OfficialResult};
export type PaperLedgerEvent={
 version:typeof PAPER_LEDGER_VERSION;sequence:number;requestId:string;recordedAt:string;
 previousHash:string|null;payload:PaperLedgerPayload;hash:string;
};
export type PaperJournal=readonly PaperLedgerEvent[];
export type AllocationReason='ALLOCATED'|'PAUSED'|'NO_CANDIDATE'|'POSITION_COST_LIMIT'|
 'OPEN_COST_LIMIT'|'OPEN_POSITION_LIMIT'|'INSUFFICIENT_FUNDS';
export type PaperLedgerPosition={
 forecast:PaperForecast;recordedAt:string;allocated:boolean;allocationReason:AllocationReason;
 costMicros:number;
 grades:{revision:number;recordedAt:string;fetchedAt:string;grade:PaperGrade}[];
};
export type PaperLedgerView={
 version:typeof PAPER_LEDGER_VERSION;mode:'OFFLINE_FIXTURE';asOf:string;ledgerId:string;
 paused:boolean;initialBalanceMicros:number;balanceMicros:number;reservedMicros:number;
 availableMicros:number;deficitMicros:number;hypotheticalNetMicros:number;
 allocatedPositions:number;openPositions:number;settledPositions:number;
 positions:PaperLedgerPosition[];
 warning:string;
};
const fail=(reason:string):never=>{throw Error('KALSHI_LEDGER_'+reason);};
function iso(value:string):string{
 if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))
  return fail('INVALID_TIME');
 return new Date(value).toISOString();
}
function money(n:number,positive=false):number{
 if(!Number.isSafeInteger(n)||n<(positive?1:0)||n>1_000_000_000_000)return fail('INVALID_MONEY');
 return n;
}
function checked(n:number):number{
 if(!Number.isSafeInteger(n))return fail('MONEY_OVERFLOW');
 return n;
}
function configValid(c:PaperLedgerConfig){
 if(!c||!ID.test(c.id)||c.mode!=='OFFLINE_FIXTURE')return fail('INVALID_CONFIG');
 money(c.initialBalanceMicros,true);money(c.maxPositionCostMicros,true);money(c.maxOpenCostMicros,true);
 if(c.maxPositionCostMicros>c.maxOpenCostMicros||c.maxOpenCostMicros>c.initialBalanceMicros||
  !Number.isSafeInteger(c.maxOpenPositions)||c.maxOpenPositions<1||c.maxOpenPositions>100)
  return fail('INVALID_CONFIG');
}
/** Sorted JSON also makes the existing paper book digest stable after serialization. */
const copy=<T>(value:T):T=>JSON.parse(canonicalJson(value)) as T;
function frozen<T>(value:T):T{
 if(value!==null&&typeof value==='object'){
  for(const child of Object.values(value))frozen(child);
  Object.freeze(value);
 }
 return value;
}
function verify(events:PaperJournal){
 if(!Array.isArray(events)||events.length<1||events.length>MAX_EVENTS)return fail('INVALID_JOURNAL');
 let previous:string|null=null,last=-Infinity;
 const requests=new Set<string>();
 for(let i=0;i<events.length;i++){
  const e=events[i];
  if(!e||e.version!==PAPER_LEDGER_VERSION||e.sequence!==i+1||e.previousHash!==previous||
   typeof e.requestId!=='string'||!ID.test(e.requestId)||requests.has(e.requestId)||!SHA.test(e.hash))
   return fail('INVALID_CHAIN');
  const {hash,...unsigned}=e;
  if(sha256(canonicalJson(unsigned))!==hash)return fail('CHECKSUM_MISMATCH');
  if(iso(e.recordedAt)!==e.recordedAt||Date.parse(e.recordedAt)<last)return fail('NONMONOTONIC_TIME');
  requests.add(e.requestId);previous=hash;last=Date.parse(e.recordedAt);
 }
}

/** Rebuild from immutable commands; money and model outputs are never accepted from a caller. */
export function replayPaperLedger(events:PaperJournal,asOf?:string):PaperLedgerView{
 verify(events);
 // Validate the full journal even when the requested view stops before its last event.
 const end=iso(asOf??events[events.length-1].recordedAt),cutoff=Date.parse(end);
 let config:PaperLedgerConfig|null=null,paused=true,balance=0,reserved=0;
 const positions:PaperLedgerPosition[]=[],byForecast=new Map<string,PaperLedgerPosition>();
 const markets=new Set<string>();
 let selectedBalance=0,selectedReserved=0,selectedPaused=true,captured=false;
 const selected:PaperLedgerPosition[]=[];
 const capture=()=>{
  selectedBalance=balance;selectedReserved=reserved;selectedPaused=paused;
  selected.push(...copy(positions));captured=true;
 };
 for(const e of events){
  const p=copy(e.payload),at=Date.parse(e.recordedAt);
  // Copy the projection once at the cutoff; continue validating later commands separately.
  if(at>cutoff&&!captured)capture();
  if(p?.type==='register'){
   if(e.sequence!==1||config!==null)return fail('REGISTER_ONCE');
   configValid(p.config);config=p.config;balance=config.initialBalanceMicros;
  }else{
   if(!config)return fail('REGISTER_FIRST');
   if(p?.type==='control'){
    if(typeof p.paused!=='boolean'||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>300)
     return fail('INVALID_CONTROL');
    paused=p.paused;
   }else if(p?.type==='forecast'){
    // The receipt clock is authoritative. An input's forged predictedAt is overwritten.
    const forecast=freezePaperForecast({...p.input,predictedAt:e.recordedAt});
    if(markets.has(forecast.marketTicker))return fail('DUPLICATE_MARKET');
    markets.add(forecast.marketTicker);
    const cost=forecast.decision==='PAPER_CANDIDATE'
     ?checked(forecast.contracts*forecast.priceMicros!+forecast.feeMicros+forecast.slippageMicros):0;
    const open=positions.filter(x=>x.allocated&&x.grades.length===0).length;
    const reason:AllocationReason=paused?'PAUSED':!cost?'NO_CANDIDATE':
     cost>config.maxPositionCostMicros?'POSITION_COST_LIMIT':
     cost>balance-reserved?'INSUFFICIENT_FUNDS':
     reserved+cost>config.maxOpenCostMicros?'OPEN_COST_LIMIT':
     open>=config.maxOpenPositions?'OPEN_POSITION_LIMIT':'ALLOCATED';
    const allocated=reason==='ALLOCATED';
    if(allocated)reserved=checked(reserved+cost);
    const position={forecast,recordedAt:e.recordedAt,allocated,allocationReason:reason,costMicros:cost,grades:[]};
    positions.push(position);byForecast.set(forecast.id,position);
   }else if(p?.type==='settlement'){
    const position=byForecast.get(p.forecastId);
    if(!position)return fail('UNKNOWN_FORECAST');
    if(Date.parse(iso(p.official.fetchedAt))>at||Date.parse(position.forecast.closeTime)>at)
     return fail('FUTURE_RESULT');
    const grade=gradePaperForecast(position.forecast,p.official);
    const old=position.grades[position.grades.length-1];
    if(old&&Date.parse(p.official.fetchedAt)<Date.parse(old.fetchedAt))return fail('STALE_RESULT');
    if(old&&old.grade.id!==grade.id&&Date.parse(p.official.fetchedAt)===Date.parse(old.fetchedAt))
     return fail('RESULT_CONFLICT');
    if(!old||old.grade.id!==grade.id){
     if(position.allocated){
      if(!Number.isSafeInteger(grade.virtualNetMicros))return fail('INVALID_GRADE_MONEY');
      if(!old)reserved=checked(reserved-position.costMicros);
      balance=checked(balance+grade.virtualNetMicros!-(old?.grade.virtualNetMicros??0));
     }
     position.grades.push({revision:position.grades.length+1,recordedAt:e.recordedAt,
      fetchedAt:iso(p.official.fetchedAt),grade});
    }
   }else return fail('INVALID_EVENT');
  }
 }
 if(!config||Date.parse(events[0].recordedAt)>cutoff)return fail('NOT_REGISTERED_AT_ASOF');
 if(!captured)capture();
 const available=checked(selectedBalance-selectedReserved);
 const allocated=selected.filter(x=>x.allocated);
 return frozen({version:PAPER_LEDGER_VERSION,mode:'OFFLINE_FIXTURE',asOf:end,ledgerId:config.id,
  paused:selectedPaused,initialBalanceMicros:config.initialBalanceMicros,balanceMicros:selectedBalance,
  reservedMicros:selectedReserved,availableMicros:available,deficitMicros:Math.max(0,-available),
  hypotheticalNetMicros:checked(selectedBalance-config.initialBalanceMicros),
  allocatedPositions:allocated.length,openPositions:allocated.filter(x=>x.grades.length===0).length,
  settledPositions:allocated.filter(x=>x.grades.length>0).length,positions:selected,
  warning:'Offline synthetic fixtures only. Allocations, fees and returns are hypothetical; no exchange fill or strategy advantage is demonstrated.'});
}

function append(events:PaperJournal,requestId:string,payload:PaperLedgerPayload,recordedAt:string):PaperJournal{
 if(typeof requestId!=='string'||!ID.test(requestId))return fail('INVALID_REQUEST_ID');
 if(events.length){
  replayPaperLedger(events);
  const previous=events.find(x=>x.requestId===requestId);
  if(previous){
   if(canonicalJson(previous.payload)!==canonicalJson(payload))return fail('IDEMPOTENCY_CONFLICT');
   return frozen(copy(events));
  }
 }
 const unsigned={version:PAPER_LEDGER_VERSION,sequence:events.length+1,requestId,
  recordedAt:iso(recordedAt),previousHash:events[events.length-1]?.hash??null,payload:copy(payload)};
 const next=[...copy(events),{...unsigned,hash:sha256(canonicalJson(unsigned))}];
 replayPaperLedger(next);
 return frozen(next);
}
export function createPaperLedger(config:PaperLedgerConfig,recordedAt:string):PaperJournal{
 return append([],'register',{type:'register',config},recordedAt);
}
export function setPaperLedgerPaused(events:PaperJournal,requestId:string,paused:boolean,reason:string,recordedAt:string):PaperJournal{
 return append(events,requestId,{type:'control',paused,reason},recordedAt);
}
export function recordPaperForecast(events:PaperJournal,requestId:string,input:LedgerForecastInput,recordedAt:string):PaperJournal{
 return append(events,requestId,{type:'forecast',input},recordedAt);
}
export function recordPaperSettlement(events:PaperJournal,requestId:string,forecastId:string,official:OfficialResult,recordedAt:string):PaperJournal{
 return append(events,requestId,{type:'settlement',forecastId,official},recordedAt);
}
