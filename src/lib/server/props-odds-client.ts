/**
 * The Odds API v4 client for NBA DFS player props (documented endpoints only).
 * SERVER/WORKER ONLY. The API key travels in the query string as the provider
 * requires, so request URLs and thrown messages are never logged or returned.
 * Provider calls are NEVER retried automatically: each attempt can cost credits,
 * and every attempt is reserved before it is sent.
 */
import {PROPS_SPORT_KEY,PROPS_REGION,PLATFORMS,PLATFORM_BOOKMAKER,STATS,STAT_MARKET} from '../props/contract.ts';
import {providerUsage} from '../props/budget.ts';

export type ProviderReply={ok:boolean;httpStatus:number;body:unknown;receivedAt:string;
 usage:{remaining:number|null;used:number|null;last:number|null}};
export interface PropsOddsClient{
 events():Promise<ProviderReply>;
 eventOdds(eventId:string):Promise<ProviderReply>;
}
export class ProviderError extends Error{
 readonly code:string;
 constructor(code:string){super('Provider request failed: '+code);this.name='ProviderError';this.code=code;}
}
const BASE='https://api.the-odds-api.com/v4/sports/'+PROPS_SPORT_KEY;

/** Exact request parameters (without the key) for audit records and tests. */
export function eventOddsParams(){
 return {regions:PROPS_REGION,bookmakers:PLATFORMS.map(p=>PLATFORM_BOOKMAKER[p]).join(','),
  markets:STATS.map(s=>STAT_MARKET[s]).join(','),oddsFormat:'american',dateFormat:'iso',includeMultipliers:'true'};
}

export function theOddsApiClient(apiKey:string,fetcher:typeof fetch=fetch,clock:()=>string=()=>new Date().toISOString()):PropsOddsClient{
 if(!/^[A-Za-z0-9]{16,64}$/.test(apiKey))throw new ProviderError('INVALID_KEY_FORMAT');
 async function get(path:string,params:Record<string,string>):Promise<ProviderReply>{
  const url=new URL(BASE+path);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  url.searchParams.set('apiKey',apiKey);
  let response:Response;
  try{response=await fetcher(url,{cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15_000)});}
  catch{throw new ProviderError('TRANSPORT_OR_TIMEOUT');}
  const receivedAt=clock();
  let text:string;
  try{text=await response.text();}catch{throw new ProviderError('BODY_UNREADABLE');}
  if(text.length>3_000_000)throw new ProviderError('BODY_TOO_LARGE');
  let body:unknown=null;
  try{body=text?JSON.parse(text):null;}catch{if(response.ok)throw new ProviderError('BODY_NOT_JSON');}
  return {ok:response.ok,httpStatus:response.status,body,receivedAt,usage:providerUsage(response.headers)};
 }
 return {
  events:()=>get('/events',{dateFormat:'iso'}),
  eventOdds:(id:string)=>{
   if(!/^[A-Za-z0-9_-]{6,80}$/.test(id))throw new ProviderError('INVALID_EVENT_ID');
   return get('/events/'+id+'/odds',eventOddsParams());
  },
 };
}
