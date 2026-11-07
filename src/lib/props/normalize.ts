/**
 * Pure adapter: The Odds API event-odds response (region us_dfs) -> admitted
 * PrizePicks / Pick6 standard player-stat lines, plus explicit rejections.
 * No network, database, or wall-clock reads. The caller supplies ingestedAt
 * (our receipt time) and the event as listed by the events endpoint.
 */
import {createHash} from 'node:crypto';
import {
 PROPS_PROVIDER,PROPS_SPORT_KEY,PLATFORMS,PLATFORM_BOOKMAKER,MARKET_STAT,OBSERVATION_RULES,
 type Platform,type PropObservation,type RejectedObservation,type ObservationReject,
} from './contract.ts';

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:null;
function iso(v:unknown):string|null{
 if(typeof v!=='string'||v.length>40||!/(?:Z|[+-]\d\d:\d\d)$/.test(v))return null;
 const ms=Date.parse(v);
 return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function name(v:unknown):string|null{
 if(typeof v!=='string')return null;
 const t=v.trim().replace(/\s+/g,' ');
 return t.length>0&&t.length<=120?t:null;
}
function american(v:unknown):number|null{
 return typeof v==='number'&&Number.isSafeInteger(v)&&(v<=-100||v>=100)?v:null;
}

/** Deterministic JSON (sorted keys) so equal payloads hash equally. */
export function canonicalJson(v:unknown):string{
 if(Array.isArray(v))return '['+v.map(canonicalJson).join(',')+']';
 const o=obj(v);
 if(o)return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(o[k])).join(',')+'}';
 return JSON.stringify(v)??'null';
}
export const sha256=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');

export type ListedEvent={id:string;commenceTime:string;homeTeam:string;awayTeam:string};
export type PropNormalization={
 observations:PropObservation[];
 rejected:RejectedObservation[];
 responseSha256:string;
 eventLocked:boolean;
};

const bookToPlatform=new Map<string,Platform>(PLATFORMS.map(p=>[PLATFORM_BOOKMAKER[p],p]));

export function normalizePropEvent(raw:unknown,listed:ListedEvent,ingestedAt:string):PropNormalization{
 const now=Date.parse(ingestedAt);
 if(!Number.isFinite(now))throw new Error('PROPS_INVALID_INGESTION_TIME');
 const responseSha256=sha256(canonicalJson(raw));
 const rejected:RejectedObservation[]=[];
 const reject=(reason:ObservationReject,x:Partial<RejectedObservation>={})=>rejected.push({
  platform:null,bookmakerKey:null,marketKey:null,playerName:null,line:null,...x,reason});
 const event=obj(raw);
 const listedStart=iso(listed.commenceTime);
 if(!event||!listedStart){reject('invalid_event');return {observations:[],rejected,responseSha256,eventLocked:false};}
 const id=name(event.id),home=name(event.home_team),away=name(event.away_team),start=iso(event.commence_time);
 if(id!==listed.id||event.sport_key!==PROPS_SPORT_KEY||!home||!away||!start||
  home!==listed.homeTeam||away!==listed.awayTeam||home===away){
  reject('event_mismatch');return {observations:[],rejected,responseSha256,eventLocked:false};
 }
 // Lock at the earlier of the listed and the returned start; never extend a deadline.
 const lockMs=Math.min(Date.parse(start),Date.parse(listedStart));
 const lockAt=new Date(lockMs).toISOString();
 if(lockMs-now<=OBSERVATION_RULES.lockBufferMs){
  reject('event_locked');return {observations:[],rejected,responseSha256,eventLocked:true};
 }
 type Side={price:number|null;multiplier:number|null;raw:Obj};
 type Group={platform:Platform;book:string;market:string;player:string;line:number;updated:string;
  over?:Side;under?:Side;bad?:ObservationReject};
 const groups=new Map<string,Group>();
 const linesPerPlayer=new Map<string,Set<number>>();
 const books=Array.isArray(event.bookmakers)?event.bookmakers:[];
 for(const b of books){
  const book=obj(b);const key=book?name(book.key):null;
  if(!book||!key)continue;
  const platform=bookToPlatform.get(key);
  if(!platform){reject('unknown_bookmaker',{bookmakerKey:key});continue;}
  for(const m of Array.isArray(book.markets)?book.markets:[]){
   const market=obj(m);const mkey=market?name(market.key):null;
   if(!market||!mkey)continue;
   if(!MARKET_STAT[mkey]){reject('unsupported_market',{platform,bookmakerKey:key,marketKey:mkey});continue;}
   const updated=iso(market.last_update);
   const base={platform,bookmakerKey:key,marketKey:mkey};
   if(!updated){reject('missing_last_update',base);continue;}
   const u=Date.parse(updated);
   if(u>now+OBSERVATION_RULES.maxClockSkewMs){reject('future_quote',base);continue;}
   if(now-u>OBSERVATION_RULES.maxQuoteAgeMs){reject('stale_quote',base);continue;}
   if(u>=lockMs){reject('quote_after_lock',base);continue;}
   for(const o of Array.isArray(market.outcomes)?market.outcomes:[]){
    const out=obj(o);
    const side=out?name(out.name)?.toLowerCase():null;
    const player=out?name(out.description):null;
    const point=out?.point;
    if(!out||!player||(side!=='over'&&side!=='under')){reject('invalid_outcome',{...base,playerName:player});continue;}
    if(typeof point!=='number'||!Number.isFinite(point)||point<OBSERVATION_RULES.minLine||
     point>OBSERVATION_RULES.maxLine||Math.round(point*2)!==point*2){
     reject('invalid_line',{...base,playerName:player});continue;
    }
    const mult=out.multiplier;
    let multiplier:number|null=null;
    if(mult!==undefined&&mult!==null){
     if(typeof mult!=='number'||!Number.isFinite(mult)){reject('invalid_outcome',{...base,playerName:player,line:point});continue;}
     multiplier=mult;
    }
    const gkey=[key,mkey,player.toLowerCase(),point].join('\u0000');
    const g=groups.get(gkey)??{platform,book:key,market:mkey,player,line:point,updated};
    const entry:Side={price:american(out.price),multiplier,raw:out};
    if(side==='over'){if(g.over)g.bad='duplicate';g.over=entry;}else{if(g.under)g.bad='duplicate';g.under=entry;}
    if(updated>g.updated)g.updated=updated;
    groups.set(gkey,g);
    const pkey=[key,mkey,player.toLowerCase()].join('\u0000');
    linesPerPlayer.set(pkey,(linesPerPlayer.get(pkey)??new Set()).add(point));
   }
  }
 }
 const observations:PropObservation[]=[];
 for(const g of groups.values()){
  const info={platform:g.platform,bookmakerKey:g.book,marketKey:g.market,playerName:g.player,line:g.line};
  if(g.bad){reject(g.bad,info);continue;}
  // Two different standard lines for one player/stat/platform: which one is offered is ambiguous.
  if((linesPerPlayer.get([g.book,g.market,g.player.toLowerCase()].join('\u0000'))?.size??0)>1){
   reject('ambiguous_line',info);continue;
  }
  if(!g.over||!g.under){reject('incomplete_pair',info);continue;}
  if([g.over.multiplier,g.under.multiplier].some(m=>m!==null&&m!==1)){reject('special_multiplier',info);continue;}
  observations.push({
   provider:PROPS_PROVIDER,platform:g.platform,bookmakerKey:g.book,providerEventId:id,
   homeTeam:home,awayTeam:away,commenceTime:start,lockAt,playerName:g.player,
   stat:MARKET_STAT[g.market],marketKey:g.market,period:'full_game',line:g.line,
   overPrice:g.over.price,underPrice:g.under.price,
   overMultiplier:g.over.multiplier,underMultiplier:g.under.multiplier,
   providerLastUpdate:g.updated,ingestedAt:new Date(now).toISOString(),
   sourceFields:{over:g.over.raw,under:g.under.raw,market_last_update:g.updated},
   responseSha256,
  });
 }
 observations.sort((a,b)=>a.platform.localeCompare(b.platform)||a.playerName.localeCompare(b.playerName)||
  a.stat.localeCompare(b.stat));
 return {observations,rejected,responseSha256,eventLocked:false};
}

/** Parse the events endpoint into upcoming listed events (live/past are excluded, not relabelled). */
export function parseEventList(raw:unknown,nowIso:string):{events:ListedEvent[];invalid:number;startedOrPast:number}{
 if(!Array.isArray(raw))throw new Error('PROPS_EVENTS_NOT_ARRAY');
 const now=Date.parse(nowIso);
 const seen=new Set<string>();
 const events:ListedEvent[]=[];let invalid=0,startedOrPast=0;
 for(const r of raw){
  const e=obj(r);
  const id=e?name(e.id):null,start=e?iso(e.commence_time):null,home=e?name(e.home_team):null,away=e?name(e.away_team):null;
  if(!e||!id||!start||!home||!away||home===away||e.sport_key!==PROPS_SPORT_KEY||seen.has(id)||!/^[A-Za-z0-9_-]{6,80}$/.test(id)){invalid++;continue;}
  seen.add(id);
  if(Date.parse(start)<=now){startedOrPast++;continue;}
  events.push({id,commenceTime:start,homeTeam:home,awayTeam:away});
 }
 events.sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.id.localeCompare(b.id));
 return {events,invalid,startedOrPast};
}
