// Test-only kit for the recurring PAPER controller: a disposable PostgreSQL store
// driven through psql with a pinned schema clock, and an in-memory fake Alpaca
// PAPER broker. Never imported by application code. Synthetic data only.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {PaperAutoStoreError} from './paper-auto-store.ts';

const PIN=`CREATE OR REPLACE FUNCTION sportsedge_paper_auto._now() RETURNS timestamptz
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(current_setting('paper_auto_test.now',true),'')::timestamptz,clock_timestamp())
$$;`;
function psql(database,sql,env={}){
 return spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',database],
  {input:sql,encoding:'utf8',env:{...process.env,...env},maxBuffer:64*1024*1024});
}
export function e2eDatabaseAvailable(){
 return process.env.PAPER_AUTO_E2E_PG==='1';
}
/** Creates a fresh database with the schema applied and the clock pinnable. */
export function createDatabase(name){
 const roles=psql('postgres',`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 END$$;`);
 if(roles.status!==0)throw Error('ROLES: '+roles.stderr);
 for(const cmd of [`DROP DATABASE IF EXISTS ${name}`,`CREATE DATABASE ${name}`]){
  const r=psql('postgres',cmd+';');
  if(r.status!==0)throw Error('CREATE_DATABASE: '+r.stderr);
 }
 const schema=readFileSync(new URL('../../../database/staging/paper_auto_v1.sql',import.meta.url),'utf8');
 const r=psql(name,schema+'\n'+PIN);
 if(r.status!==0)throw Error('SCHEMA: '+r.stderr);
 return name;
}
export function dropDatabase(name){psql('postgres',`DROP DATABASE IF EXISTS ${name} WITH (FORCE);`);}
export function sqlValue(database,sql){
 const r=psql(database,sql);
 if(r.status!==0)throw Error('SQL: '+r.stderr);
 return r.stdout.trim();
}
/** Same contract as the PostgREST store; the database clock follows the fake clock. */
export function psqlStore(database,clock,latencyMs=0){
 return {
  calls:[],
  async call(fn,p){
   this.calls.push(fn);
   // Tests name calls whose next request is lost in transit, before it reaches the database.
   if(this.failOnce?.delete(fn))throw new PaperAutoStoreError('NETWORK',false);
   clock.advance(latencyMs);
   const literal=JSON.stringify(p).replaceAll("'","''");
   const r=psql(database,`SELECT public.sportsedge_paper_auto_${fn}('${literal}'::jsonb);`,
    {PGOPTIONS:'-c paper_auto_test.now='+new Date(clock.now()).toISOString()});
   if(r.status!==0){
    const code=/ERROR:\s+(PAPER_AUTO_[A-Z0-9_]+)/.exec(r.stderr)?.[1];
    throw new PaperAutoStoreError(code??'DB_ERROR',true);
   }
   return JSON.parse(r.stdout.trim());
  }
 };
}
export function fakeClock(startIso){
 let ms=Date.parse(startIso);
 return {now:()=>ms,set:(iso)=>{ms=Date.parse(iso);},advance:(n)=>{ms+=n;},
  sleep:async(n)=>{ms+=n;}};
}
const iso=(ms)=>new Date(ms).toISOString();
const dollars=(cents)=>`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
let activitySeq=0;
/** In-memory Alpaca PAPER account. POST behaviors are consumed in order (default: fill). */
export class FakeBroker{
 constructor(clock,{accountId,accountNumber,cashCents,writesEnabled=true}){
  Object.assign(this,{time:clock,writesEnabled,accountId,accountNumber,cashCents,
   positionsBySymbol:new Map(),orders:[],activities:[],quotes:new Map(),behaviors:[],
   posts:[],cancels:[],hidden:[],quoteAgeMs:1000,status:'ACTIVE',reportedAccountId:accountId,lookupBlind:false,
   costBySymbol:new Map()});
 }
 setQuote(symbol,askCents,bidCents=askCents-1){this.quotes.set(symbol,{askCents,bidCents});}
 mark(symbol){return this.quotes.get(symbol)?.askCents??0;}
 async account(){
  const lmv=[...this.positionsBySymbol].reduce((n,[s,q])=>n+q*this.mark(s),0);
  return {id:this.reportedAccountId,accountNumber:this.accountNumber,status:this.status,currency:'USD',
   cashCents:this.cashCents,equityCents:this.cashCents+lmv,lastEquityCents:this.cashCents+lmv,
   longMarketValueCents:lmv,buyingPowerCents:this.cashCents,tradingBlocked:false,accountBlocked:false,
   readAt:iso(this.time.now())};
 }
 async positions(){
  return [...this.positionsBySymbol].filter(([,q])=>q!==0).map(([symbol,q])=>({symbol,assetId:'asset-'+symbol,
   qty:String(Math.abs(q)),side:q>0?'long':'short',marketValueCents:q*this.mark(symbol),
   costBasisCents:this.costBySymbol.get(symbol)??0}));
 }
 view(o){const v={...o};delete v.fillAfterLookups;delete v.fillCents;return v;}
 async openOrders(){
  return this.orders.filter(o=>['new','accepted','partially_filled'].includes(o.status)).map(o=>this.view(o));
 }
 async ordersSubmittedSince(after){
  return this.orders.filter(o=>Date.parse(o.submittedAt)>=Date.parse(after)).map(o=>this.view(o));
 }
 async orderByClientId(clientOrderId){
  if(this.lookupBlind)return null; // an order the broker accepted but cannot show yet
  const o=this.orders.find(x=>x.clientOrderId===clientOrderId);
  if(o&&o.fillAfterLookups!==undefined&&--o.fillAfterLookups===0)this.fill(o,Number(o.qty),o.fillCents);
  return o?this.view(o):null;
 }
 fill(o,qty,priceCents){
  const before=Number(o.filledQty);
  o.filledQty=String(before+qty);
  o.filledAvgPrice=dollars(priceCents);
  o.status=Number(o.filledQty)===Number(o.qty)?'filled':'partially_filled';
  const sign=o.side==='buy'?1:-1;
  this.cashCents-=sign*qty*priceCents;
  // Average cost, as Alpaca reports it: buys add at the fill price; sells release a pro-rata share.
  const held=this.positionsBySymbol.get(o.symbol)??0,cost=this.costBySymbol.get(o.symbol)??0;
  this.costBySymbol.set(o.symbol,sign>0?cost+qty*priceCents:held===qty?0:Math.round(cost*(held-qty)/held));
  this.positionsBySymbol.set(o.symbol,held+sign*qty);
  activitySeq++;
  this.activities.push({id:`20261019${String(activitySeq).padStart(9,'0')}::fill-${activitySeq}`,
   activityType:'FILL',at:iso(this.time.now()),symbol:o.symbol,side:o.side,qty:String(qty),
   price:dollars(priceCents),netAmountCents:null,orderId:o.id,rawDigest:String(activitySeq).padStart(64,'a')});
 }
 create(req,status='accepted'){
  const o={id:'b-'+req.clientOrderId.slice(4,16)+'-'+(this.orders.length+1),clientOrderId:req.clientOrderId,
   symbol:req.symbol,side:req.side,type:'limit',timeInForce:'day',status,qty:String(req.shares),filledQty:'0',
   filledAvgPrice:null,limitPrice:dollars(req.limitCents),submittedAt:iso(this.time.now()),extendedHours:false};
  this.orders.push(o);
  return o;
 }
 async submitLimitOrder(req){
  if(!this.writesEnabled)throw Error('FAKE_WRITES_DISABLED');
  this.posts.push(req);
  const b=this.behaviors.shift()??'fill';
  if(b==='reject403')return {kind:'rejected',httpStatus:403,code:'40310000',message:'insufficient buying power'};
  if(b==='timeout_absent')return {kind:'uncertain',reason:'NETWORK'};
  if(b==='timeout_late'){this.hidden.push(req);return {kind:'uncertain',reason:'NETWORK'};}
  const o=this.create(req);
  const ack={...o};
  if(b==='fill'||b==='duplicate'||b==='timeout_exists')this.fill(o,req.shares,req.limitCents);
  if(typeof b==='string'&&b.startsWith('partial:'))this.fill(o,Number(b.slice(8)),req.limitCents);
  if(b==='rest'||b.startsWith('partial:'))o.status=o.filledQty==='0'?'new':'partially_filled';
  if(b.startsWith('slowfill:')){o.status='new';o.fillAfterLookups=Number(b.slice(9));o.fillCents=req.limitCents;}
  if(b==='duplicate')return {kind:'duplicate_client_id'};
  if(b==='timeout_exists')return {kind:'uncertain',reason:'NETWORK'};
  return {kind:'acknowledged',order:ack};
 }
 /** A POST that timed out reaches the broker later and fills. */
 revealLate(){
  for(const req of this.hidden.splice(0)){const o=this.create(req);this.fill(o,req.shares,req.limitCents);}
 }
 async cancelOrder(id){
  if(!this.writesEnabled)throw Error('FAKE_WRITES_DISABLED');
  this.cancels.push(id);
  const o=this.orders.find(x=>x.id===id);
  if(!o)return 'not_found';
  if(!['new','accepted','partially_filled'].includes(o.status))return 'not_cancelable';
  o.status='canceled';
  return 'requested';
 }
 sessionFor(date){
  const day=new Date(date+'T12:00:00Z').getUTCDay();
  if(day===0||day===6)return null;
  const offset=date<'2026-11-01'?4:5;
  return {date,openAt:iso(Date.parse(date+'T09:30:00Z')+offset*3_600_000),
   closeAt:iso(Date.parse(date+'T16:00:00Z')+offset*3_600_000)};
 }
 async clock(){
  const now=this.time.now(),s=this.sessionFor(iso(now-5*3_600_000).slice(0,10));
  const open=!!s&&now>=Date.parse(s.openAt)&&now<Date.parse(s.closeAt);
  return {timestamp:iso(now),isOpen:open,nextOpen:s?.openAt??iso(now),nextClose:s?.closeAt??iso(now)};
 }
 async session(date){return this.sessionFor(date);}
 async latestQuotes(symbols){
  const out=new Map();
  for(const symbol of symbols){
   const q=this.quotes.get(symbol);
   if(q)out.set(symbol,{symbol,bidCents:q.bidCents,askCents:q.askCents,
    observedAt:iso(this.time.now()-this.quoteAgeMs),feed:'iex'});
  }
  return out;
 }
 async activitiesSince(after){return this.activities.filter(a=>Date.parse(a.at)>=Date.parse(after));}
 async dailyClose(symbol,session){
  if(this.failOnce?.delete('dailyClose'))throw Object.assign(Error('fake network failure'),{code:'NETWORK'});
  return {symbol,session,close:'581.25',source:'test:fake-sip-close'};
 }
 addDeposit(cents){
  activitySeq++;
  this.cashCents+=cents;
  this.activities.push({id:`20261019${String(activitySeq).padStart(9,'0')}::csd-${activitySeq}`,activityType:'CSD',
   at:iso(this.time.now()),symbol:null,side:null,qty:null,price:null,netAmountCents:cents,orderId:null,
   rawDigest:String(activitySeq).padStart(64,'b')});
 }
}
